const User = require('../models/User');
const Ride = require('../models/Ride');
const Booking = require('../models/Booking');
const Report = require('../models/Report');
const { getIO } = require('../socket');

// ── Dashboard Stats ────────────────────────────────────────────────────────
exports.getStats = async (req, res) => {
  try {
    const [
      totalUsers, drivers, passengers, bannedUsers,
      totalRides, activeRides, completedRides, cancelledRides,
      totalBookings, confirmedBookings, pendingBookings,
      pendingReports, revenueAgg, newUsersThisMonth, newRidesThisMonth
    ] = await Promise.all([
      User.countDocuments({ userType: { $ne: 'admin' } }),
      User.countDocuments({ userType: 'driver' }),
      User.countDocuments({ userType: 'passenger' }),
      User.countDocuments({ isBanned: true }),
      Ride.countDocuments(),
      Ride.countDocuments({ status: 'active' }),
      Ride.countDocuments({ status: 'completed' }),
      Ride.countDocuments({ status: 'cancelled' }),
      Booking.countDocuments(),
      Booking.countDocuments({ status: 'confirmed' }),
      Booking.countDocuments({ status: 'pending' }),
      Report.countDocuments({ status: 'pending' }),
      Booking.aggregate([
        { $match: { status: { $in: ['confirmed', 'completed'] } } },
        { $group: { _id: null, total: { $sum: '$totalPrice' } } }
      ]),
      User.countDocuments({ createdAt: { $gte: new Date(Date.now() - 30*24*60*60*1000) } }),
      Ride.countDocuments({ createdAt: { $gte: new Date(Date.now() - 30*24*60*60*1000) } })
    ]);

    const totalRevenue = revenueAgg[0]?.total || 0;

    // Monthly revenue for chart (last 6 months)
    const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    const monthlyRevenue = await Booking.aggregate([
      { $match: { status: { $in: ['confirmed', 'completed'] }, createdAt: { $gte: sixMonthsAgo } } },
      { $group: {
        _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
        revenue: { $sum: '$totalPrice' }, count: { $sum: 1 }
      }},
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    res.json({
      users: { total: totalUsers, drivers, passengers, banned: bannedUsers, newThisMonth: newUsersThisMonth },
      rides: { total: totalRides, active: activeRides, completed: completedRides, cancelled: cancelledRides, newThisMonth: newRidesThisMonth },
      bookings: { total: totalBookings, confirmed: confirmedBookings, pending: pendingBookings },
      finance: { totalRevenue },
      reports: { pending: pendingReports },
      charts: { monthlyRevenue }
    });
  } catch (err) { res.status(500).json({ error: 'Failed to load stats' }); }
};

// ── Users ──────────────────────────────────────────────────────────────────
exports.getUsers = async (req, res) => {
  try {
    const { search, userType, banned, page = 1, limit = 20 } = req.query;
    const filter = { userType: { $ne: 'admin' } };
    if (userType) filter.userType = userType;
    if (banned !== undefined) filter.isBanned = banned === 'true';
    if (search) {
      const re = new RegExp(search, 'i');
      filter.$or = [{ name: re }, { email: re }];
    }
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [users, total] = await Promise.all([
      User.find(filter).select('-passwordHash').sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      User.countDocuments(filter)
    ]);
    res.json({ users, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) { res.status(500).json({ error: 'Failed to load users' }); }
};

exports.banUser = async (req, res) => {
  try {
    const { reason } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isBanned: true, banReason: reason || 'Violation of terms' },
      { new: true }
    ).select('-passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ message: `${user.name} has been banned`, user });
  } catch (err) { res.status(500).json({ error: 'Failed to ban user' }); }
};

exports.unbanUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isBanned: false, $unset: { banReason: '' } },
      { new: true }
    ).select('-passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ message: `${user.name} has been unbanned`, user });
  } catch (err) { res.status(500).json({ error: 'Failed to unban user' }); }
};

exports.getUserDetail = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found' });
    const [rides, bookings, reportsAgainst] = await Promise.all([
      Ride.find({ driver: user._id }).sort({ createdAt: -1 }).limit(5),
      Booking.find({ passenger: user._id }).populate('ride', 'from to date').sort({ createdAt: -1 }).limit(5),
      Report.countDocuments({ reported: user._id })
    ]);
    res.json({ user, rides, bookings, reportsAgainst });
  } catch (err) { res.status(500).json({ error: 'Failed to load user detail' }); }
};

// ── Rides ──────────────────────────────────────────────────────────────────
exports.getRides = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (search) {
      const re = new RegExp(search, 'i');
      filter.$or = [{ from: re }, { to: re }];
    }
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [rides, total] = await Promise.all([
      Ride.find(filter).populate('driver', 'name email').sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      Ride.countDocuments(filter)
    ]);
    res.json({ rides, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) { res.status(500).json({ error: 'Failed to load rides' }); }
};

exports.adminCancelRide = async (req, res) => {
  try {
    const { reason = 'Admin action' } = req.body;
    const ride = await Ride.findById(req.params.id);
    if (!ride) return res.status(404).json({ error: 'Ride not found' });

    ride.status = 'cancelled';
    ride.cancellationReason = reason;
    await ride.save();

    const bookings = await Booking.find({ ride: ride._id, status: { $in: ['pending', 'confirmed', 'waitlisted'] } });
    await Booking.updateMany(
      { ride: ride._id, status: { $in: ['pending', 'confirmed', 'waitlisted'] } },
      { status: 'cancelled', cancellationReason: reason }
    );

    const io = getIO();
    if (io) {
      bookings.forEach(b => {
        io.to(`user_${b.passenger}`).emit('ride_cancelled', {
          rideId: ride._id, from: ride.from, to: ride.to, date: ride.date, reason
        });
      });
    }
    res.json({ message: 'Ride cancelled by admin', affectedBookings: bookings.length });
  } catch (err) { res.status(500).json({ error: 'Failed to cancel ride' }); }
};

// ── Bookings ───────────────────────────────────────────────────────────────
exports.getBookings = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .populate('passenger', 'name email')
        .populate({ path: 'ride', populate: { path: 'driver', select: 'name email' } })
        .sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      Booking.countDocuments(filter)
    ]);
    res.json({ bookings, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) { res.status(500).json({ error: 'Failed to load bookings' }); }
};

exports.adminCancelBooking = async (req, res) => {
  try {
    const { reason = 'Admin action' } = req.body;
    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { status: 'cancelled', cancellationReason: reason },
      { new: true }
    ).populate('ride');
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    if (booking.ride && booking.ride.status === 'active') {
      await Ride.findByIdAndUpdate(booking.ride._id, { $inc: { availableSeats: booking.seats } });
    }
    res.json({ message: 'Booking cancelled by admin', booking });
  } catch (err) { res.status(500).json({ error: 'Failed to cancel booking' }); }
};

// ── Reports ────────────────────────────────────────────────────────────────
exports.getReports = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [reports, total] = await Promise.all([
      Report.find(filter)
        .populate('reporter', 'name email userType')
        .populate('reported', 'name email userType isBanned')
        .populate('ride', 'from to date')
        .sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      Report.countDocuments(filter)
    ]);
    res.json({ reports, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) { res.status(500).json({ error: 'Failed to load reports' }); }
};

exports.resolveReport = async (req, res) => {
  try {
    const { action, adminNote } = req.body; // action: 'actioned' | 'dismissed'
    if (!['actioned', 'dismissed'].includes(action))
      return res.status(400).json({ error: 'Invalid action' });
    const report = await Report.findByIdAndUpdate(req.params.id, {
      status: action, adminNote, resolvedAt: new Date(), resolvedBy: req.user.id
    }, { new: true });
    if (!report) return res.status(404).json({ error: 'Report not found' });

    // If actioned, increment report count on reported user
    if (action === 'actioned') {
      await User.findByIdAndUpdate(report.reported, { $inc: { reportCount: 1 } });
    }
    res.json(report);
  } catch (err) { res.status(500).json({ error: 'Failed to resolve report' }); }
};
