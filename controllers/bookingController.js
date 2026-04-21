const Booking = require('../models/Booking');
const Ride = require('../models/Ride');
const { getIO } = require('../socket');

// ── Helper: promote first waitlisted passenger after a seat frees up ─────────
async function promoteWaitlist(rideId) {
  const ride = await Ride.findById(rideId);
  if (!ride || !ride.waitlist.length || ride.availableSeats <= 0) return;

  const next = ride.waitlist.find(w => w.seats <= ride.availableSeats);
  if (!next) return;

  // Remove from waitlist
  ride.waitlist = ride.waitlist.filter(w => w.passenger.toString() !== next.passenger.toString());

  // Find their waitlisted booking and confirm it
  const booking = await Booking.findOneAndUpdate(
    { ride: rideId, passenger: next.passenger, status: 'waitlisted' },
    { status: 'confirmed' },
    { new: true }
  );

  if (booking) {
    ride.availableSeats -= next.seats;
    await ride.save();

    const io = getIO();
    if (io) {
      io.to(`user_${next.passenger}`).emit('waitlist_promoted', {
        rideId, from: ride.from, to: ride.to, date: ride.date,
        bookingId: booking._id
      });
    }
  } else {
    await ride.save();
  }
}

// ── Create Booking ─────────────────────────────────────────────────────────
exports.createBooking = async (req, res) => {
  try {
    const { rideId, seats = 1 } = req.body;
    const seatCount = Math.max(1, parseInt(seats) || 1);

    const ride = await Ride.findById(rideId);
    if (!ride) return res.status(404).json({ error: 'Ride not found' });
    if (!['active', 'started'].includes(ride.status))
      return res.status(400).json({ error: 'This ride is no longer available for booking' });
    if (ride.driver.toString() === req.user.id)
      return res.status(400).json({ error: 'Cannot book your own ride' });

    // Check existing booking
    const existing = await Booking.findOne({
      ride: rideId, passenger: req.user.id,
      status: { $in: ['pending', 'confirmed', 'waitlisted'] }
    });
    if (existing) return res.status(400).json({ error: 'You already have a booking for this ride' });

    // Waitlist if not enough seats
    if (ride.availableSeats < seatCount) {
      // Add to ride waitlist array
      const alreadyWaiting = ride.waitlist.find(w => w.passenger.toString() === req.user.id);
      if (alreadyWaiting) return res.status(400).json({ error: 'You are already on the waitlist' });

      ride.waitlist.push({ passenger: req.user.id, seats: seatCount });
      await ride.save();

      const booking = await Booking.create({
        ride: rideId, passenger: req.user.id,
        seats: seatCount, seatNumber: 0, totalPrice: ride.price * seatCount,
        status: 'waitlisted'
      });
      ride.bookings.push(booking._id);
      await ride.save();

      await booking.populate([
        { path: 'ride', populate: { path: 'driver', select: 'name email' } },
        { path: 'passenger', select: 'name email' }
      ]);
      return res.status(201).json({ ...booking.toObject(), waitlisted: true });
    }

    const seatNumber = ride.totalSeats - ride.availableSeats + 1;
    const booking = await Booking.create({
      ride: rideId, passenger: req.user.id,
      seats: seatCount, seatNumber, totalPrice: ride.price * seatCount
    });

    ride.availableSeats -= seatCount;
    ride.bookings.push(booking._id);
    await ride.save();

    await booking.populate([
      { path: 'ride', populate: { path: 'driver', select: 'name email' } },
      { path: 'passenger', select: 'name email' }
    ]);

    // Notify driver + broadcast seat update
    const io = getIO();
    if (io) {
      io.to(`user_${ride.driver}`).emit('new_booking_request', {
        bookingId: booking._id,
        passenger: req.user.name,
        from: ride.from, to: ride.to,
        seats: seatCount, date: ride.date
      });
      io.emit('seats_updated', { rideId: ride._id, availableSeats: ride.availableSeats });
    }

    res.status(201).json(booking);
  } catch (err) { res.status(500).json({ error: 'Failed to create booking: ' + err.message }); }
};

// ── My Bookings ───────────────────────────────────────────────────────────────
exports.getMyBookings = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { passenger: req.user.id };
    if (status && status !== 'all') filter.status = status;
    const bookings = await Booking.find(filter)
      .populate({ path: 'ride', populate: { path: 'driver', select: 'name email car trustScore' } })
      .sort({ bookingDate: -1 });
    res.json(bookings);
  } catch (err) { res.status(500).json({ error: 'Failed to load bookings' }); }
};

// ── Cancel Booking ────────────────────────────────────────────────────────────
exports.cancelBooking = async (req, res) => {
  try {
    const booking = await Booking.findOne({ _id: req.params.id, passenger: req.user.id });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (!['pending', 'confirmed', 'waitlisted'].includes(booking.status))
      return res.status(400).json({ error: 'This booking cannot be cancelled' });

    const wasWaitlisted = booking.status === 'waitlisted';
    booking.status = 'cancelled';
    booking.cancellationReason = 'Passenger cancelled';
    await booking.save();

    const ride = await Ride.findById(booking.ride);
    if (ride && ride.status === 'active') {
      if (!wasWaitlisted) {
        ride.availableSeats += booking.seats;
        // Remove from waitlist array if present
        ride.waitlist = ride.waitlist.filter(w => w.passenger.toString() !== req.user.id);
        await ride.save();
        // Promote waitlisted passenger
        await promoteWaitlist(ride._id);
      } else {
        // Just remove from waitlist array
        ride.waitlist = ride.waitlist.filter(w => w.passenger.toString() !== req.user.id);
        await ride.save();
      }
      const io = getIO();
      if (io) io.emit('seats_updated', { rideId: ride._id, availableSeats: ride.availableSeats });
    }

    await booking.populate({ path: 'ride', populate: { path: 'driver', select: 'name email' } });
    res.json(booking);
  } catch (err) { res.status(500).json({ error: 'Failed to cancel booking' }); }
};

// ── Accept Booking ────────────────────────────────────────────────────────────
exports.acceptBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).populate('ride');
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (!booking.ride || booking.ride.driver.toString() !== req.user.id)
      return res.status(403).json({ error: 'Access denied' });
    if (booking.status !== 'pending') return res.status(400).json({ error: 'Booking is not pending' });

    booking.status = 'confirmed';
    await booking.save();
    await booking.populate('passenger', 'name email');

    const io = getIO();
    if (io) {
      io.to(`user_${booking.passenger._id}`).emit('booking_status_changed', {
        bookingId: booking._id, status: 'confirmed',
        from: booking.ride.from, to: booking.ride.to, date: booking.ride.date
      });
    }
    res.json(booking);
  } catch (err) { res.status(500).json({ error: 'Failed to accept booking' }); }
};

// ── Reject Booking ────────────────────────────────────────────────────────────
exports.rejectBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).populate('ride');
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (!booking.ride || booking.ride.driver.toString() !== req.user.id)
      return res.status(403).json({ error: 'Access denied' });
    if (booking.status !== 'pending') return res.status(400).json({ error: 'Booking is not pending' });

    booking.status = 'cancelled';
    booking.cancellationReason = 'Driver rejected';
    await booking.save();

    // Return seats
    const ride = await Ride.findById(booking.ride._id);
    if (ride) {
      ride.availableSeats += booking.seats;
      await ride.save();
      await promoteWaitlist(ride._id);
      const io = getIO();
      if (io) io.emit('seats_updated', { rideId: ride._id, availableSeats: ride.availableSeats });
    }

    await booking.populate('passenger', 'name email');
    const io = getIO();
    if (io) {
      io.to(`user_${booking.passenger._id}`).emit('booking_status_changed', {
        bookingId: booking._id, status: 'cancelled',
        from: booking.ride.from, to: booking.ride.to, date: booking.ride.date
      });
    }
    res.json(booking);
  } catch (err) { res.status(500).json({ error: 'Failed to reject booking' }); }
};

// ── Get Ride Bookings (driver) ────────────────────────────────────────────────
exports.getRideBookings = async (req, res) => {
  try {
    const ride = await Ride.findById(req.params.rideId);
    if (!ride) return res.status(404).json({ error: 'Ride not found' });
    if (ride.driver.toString() !== req.user.id)
      return res.status(403).json({ error: 'Access denied' });
    const bookings = await Booking.find({ ride: req.params.rideId })
      .populate('passenger', 'name email trustScore totalRatings')
      .sort({ bookingDate: 1 });
    res.json(bookings);
  } catch (err) { res.status(500).json({ error: 'Failed to load bookings' }); }
};

// ── Waitlist Position ─────────────────────────────────────────────────────────
exports.getWaitlistPosition = async (req, res) => {
  try {
    const ride = await Ride.findById(req.params.rideId);
    if (!ride) return res.status(404).json({ error: 'Ride not found' });
    const idx = ride.waitlist.findIndex(w => w.passenger.toString() === req.user.id);
    res.json({ position: idx >= 0 ? idx + 1 : null, total: ride.waitlist.length });
  } catch (err) { res.status(500).json({ error: 'Failed to get waitlist position' }); }
};
