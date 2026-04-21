const { v4: uuidv4 } = require('crypto').webcrypto ? (() => {
  try { return require('crypto'); } catch { return { randomUUID: () => Math.random().toString(36).slice(2) }; }
})() : require('crypto');
const Ride = require('../models/Ride');
const Booking = require('../models/Booking');
const { getIO } = require('../socket');

const randomUUID = () => {
  try { return require('crypto').randomUUID(); } catch { return Date.now().toString(36); }
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function getNextOccurrenceDates(startDate, type, count) {
  const dates = [];
  let current = new Date(startDate);
  while (dates.length < count) {
    dates.push(new Date(current));
    if (type === 'daily') current = addDays(current, 1);
    else if (type === 'weekly') current = addDays(current, 7);
    else if (type === 'weekdays') {
      do { current = addDays(current, 1); } while ([0,6].includes(current.getDay()));
    }
  }
  return dates;
}

// ── Public ────────────────────────────────────────────────────────────────────
exports.getRides = async (req, res) => {
  try {
    const rides = await Ride.find({ status: 'active' })
      .populate('driver', 'name email trustScore totalRatings')
      .sort({ date: 1, time: 1 });
    res.json(rides);
  } catch (err) { res.status(500).json({ error: 'Failed to load rides' }); }
};

exports.searchRides = async (req, res) => {
  try {
    const { from, to, date } = req.query;
    const filter = { status: 'active', availableSeats: { $gt: 0 } };
    if (from) filter.from = new RegExp(from, 'i');
    if (to)   filter.to   = new RegExp(to, 'i');
    if (date) {
      const d0 = new Date(date);
      const d1 = new Date(date); d1.setDate(d1.getDate() + 1);
      filter.date = { $gte: d0, $lt: d1 };
    }
    const rides = await Ride.find(filter)
      .populate('driver', 'name email trustScore totalRatings')
      .sort({ date: 1, time: 1 });
    res.json(rides);
  } catch (err) { res.status(500).json({ error: 'Failed to search rides' }); }
};

exports.getRide = async (req, res) => {
  try {
    const ride = await Ride.findById(req.params.id)
      .populate('driver', 'name email trustScore totalRatings')
      .populate({ path: 'bookings', populate: { path: 'passenger', select: 'name' } });
    if (!ride) return res.status(404).json({ error: 'Ride not found' });
    res.json(ride);
  } catch (err) { res.status(500).json({ error: 'Failed to load ride' }); }
};

// ── Driver ────────────────────────────────────────────────────────────────────
exports.getMyRides = async (req, res) => {
  try {
    const { status = 'active' } = req.query;
    const filter = { driver: req.user.id };
    if (status !== 'all') filter.status = status;
    const rides = await Ride.find(filter).populate('driver', 'name email').sort({ date: -1 });
    res.json(rides);
  } catch (err) { res.status(500).json({ error: 'Failed to load rides' }); }
};

exports.createRide = async (req, res) => {
  try {
    const { from, to, date, time, seats, price, car, notes, waypoints, recurring } = req.body;
    if (!from || !to || !date || !time || !seats || price == null || !car)
      return res.status(400).json({ error: 'All required fields must be provided' });

    const base = {
      driver: req.user.id,
      from, to, date: new Date(date), time,
      totalSeats: parseInt(seats),
      availableSeats: parseInt(seats),
      price: parseFloat(price),
      car, notes,
      waypoints: Array.isArray(waypoints) ? waypoints.filter(Boolean) : []
    };

    // Recurring ride: generate multiple documents
    if (recurring?.enabled && recurring.occurrences > 1) {
      const count = Math.min(parseInt(recurring.occurrences) || 2, 12);
      const dates = getNextOccurrenceDates(date, recurring.type || 'weekly', count);
      const groupId = randomUUID();
      const docs = dates.map(d => ({
        ...base,
        date: d,
        recurring: { enabled: true, type: recurring.type, groupId, occurrences: count }
      }));
      const created = await Ride.insertMany(docs);
      await created[0].populate('driver', 'name email');
      return res.status(201).json({ rides: created, recurring: true, count: created.length });
    }

    const ride = await Ride.create(base);
    await ride.populate('driver', 'name email');
    res.status(201).json(ride);
  } catch (err) { res.status(400).json({ error: 'Failed to create ride: ' + err.message }); }
};

exports.updateRide = async (req, res) => {
  try {
    const { driver, bookings, availableSeats, status, ...allowed } = req.body;
    const ride = await Ride.findOneAndUpdate(
      { _id: req.params.id, driver: req.user.id },
      allowed,
      { new: true, runValidators: true }
    ).populate('driver', 'name email');
    if (!ride) return res.status(404).json({ error: 'Ride not found or access denied' });
    res.json(ride);
  } catch (err) { res.status(400).json({ error: 'Failed to update ride' }); }
};

exports.updateRideStatus = async (req, res) => {
  try {
    const { id: rideId } = req.params;
    const { status } = req.body;
    const driverId = req.user.id;

    // Validate status
    const validStatuses = ['started', 'en-route', 'completed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
      });
    }

    // Get ride
    const ride = await Ride.findById(rideId).populate('driver', '_id name');
    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    // Verify ownership
    if (ride.driver._id.toString() !== driverId) {
      return res.status(403).json({ error: 'Only the driver can update ride status' });
    }

    // Validate state
    if (ride.status === 'cancelled') {
      return res.status(400).json({ error: 'Cannot update status of a cancelled ride' });
    }

    if (ride.status === 'completed') {
      return res.status(400).json({ error: 'Ride is already completed' });
    }

    // Enforce status progression
    const statusOrder = { 'active': 0, 'started': 1, 'en-route': 2, 'completed': 3 };
    if (statusOrder[status] <= statusOrder[ride.status]) {
      return res.status(400).json({ 
        error: `Cannot change status from "${ride.status}" to "${status}"` 
      });
    }

    // Update ride
    const previousStatus = ride.status;
    ride.status = status;
    await ride.save();

    // Auto-complete bookings
    if (status === 'completed') {
      await Booking.updateMany(
        { ride: rideId, status: 'confirmed' },
        { status: 'completed' }
      );
    }

    // Get passengers to notify
    const bookings = await Booking.find({ 
      ride: rideId, 
      status: { $in: ['confirmed', 'completed'] } 
    });

    // Emit Socket.io events
    const io = getIO();
    if (io) {
      const statusMessages = {
        'started': '🚦 Ride has started!',
        'en-route': '🛣️ Driver is on the way',
        'completed': '🏁 Ride completed'
      };

      const notification = {
        rideId: ride._id,
        from: ride.from,
        to: ride.to,
        status,
        previousStatus,
        date: ride.date,
        time: ride.time,
        message: statusMessages[status],
        driverName: ride.driver.name,
        timestamp: new Date()
      };

      // Send to each passenger
      for (const booking of bookings) {
        io.to(`user_${booking.passenger}`).emit('ride_status_changed', notification);
      }

      // Broadcast update
      io.emit('ride_status_updated', {
        rideId: ride._id,
        status,
        previousStatus
      });
    }

    console.log(`✓ Ride ${rideId} status: ${previousStatus} → ${status}`);

    res.json({
      success: true,
      message: `Ride status updated to "${status}"`,
      ride: {
        _id: ride._id,
        status: ride.status,
        from: ride.from,
        to: ride.to,
        date: ride.date,
        time: ride.time
      },
      passengersNotified: bookings.length
    });
  } catch (err) {
    console.error('❌ Update ride status error:', err);
    res.status(500).json({ error: 'Failed to update ride status' });
  }
};

exports.cancelRide = async (req, res) => {
  try {
    const { id: rideId } = req.params;
    const { reason } = req.body;
    const driverId = req.user.id;

    // Get ride
    const ride = await Ride.findById(rideId);
    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    // Verify ownership
    if (ride.driver.toString() !== driverId) {
      return res.status(403).json({ error: 'Only the driver can cancel their ride' });
    }

    // Validate state
    if (ride.status === 'cancelled') {
      return res.status(400).json({ error: 'Ride is already cancelled' });
    }

    if (ride.status === 'completed') {
      return res.status(400).json({ error: 'Cannot cancel a completed ride' });
    }

    // Update ride
    ride.status = 'cancelled';
    ride.cancellationReason = reason || 'Cancelled by driver';
    await ride.save();

    // Cancel all bookings
    const bookings = await Booking.find({ 
      ride: rideId,
      status: { $in: ['pending', 'confirmed', 'waitlisted'] }
    });

    await Booking.updateMany(
      { ride: rideId, status: { $in: ['pending', 'confirmed', 'waitlisted'] } },
      { 
        status: 'cancelled',
        cancellationReason: ride.cancellationReason
      }
    );

    // Notify all passengers
    const io = getIO();
    if (io) {
      for (const booking of bookings) {
        io.to(`user_${booking.passenger}`).emit('ride_cancelled', {
          rideId: ride._id,
          from: ride.from,
          to: ride.to,
          date: ride.date,
          reason: ride.cancellationReason,
          message: `Ride cancelled: ${ride.cancellationReason}`,
          timestamp: new Date()
        });
      }
    }

    console.log(`✓ Ride ${rideId} cancelled with ${bookings.length} affected bookings`);

    res.json({
      success: true,
      message: `Ride cancelled. ${bookings.length} passengers notified.`,
      affectedBookings: bookings.length,
      ride: {
        _id: ride._id,
        status: 'cancelled',
        cancellationReason: ride.cancellationReason
      }
    });
  } catch (err) {
    console.error('❌ Cancel ride error:', err);
    res.status(500).json({ error: 'Failed to cancel ride' });
  }
};

exports.deleteRide = async (req, res) => {
  try {
    const ride = await Ride.findOne({ _id: req.params.id, driver: req.user.id });
    if (!ride) return res.status(404).json({ error: 'Ride not found' });
    await Booking.updateMany(
      { ride: ride._id, status: { $in: ['pending', 'confirmed'] } },
      { status: 'cancelled' }
    );
    await Ride.findByIdAndDelete(ride._id);
    res.json({ message: 'Ride deleted successfully' });
  } catch (err) { res.status(500).json({ error: 'Failed to delete ride' }); }
};
