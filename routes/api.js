const express = require('express');
const router = express.Router();

const { authMiddleware, requireRole, requireAdmin } = require('../middleware/auth');
const rideCtrl    = require('../controllers/rideController');
const bookingCtrl = require('../controllers/bookingController');
const msgCtrl     = require('../controllers/messageController');
const ratingCtrl  = require('../controllers/ratingController');
const reportCtrl  = require('../controllers/reportController');
const adminCtrl   = require('../controllers/adminController');

// ── Rides (public) ─────────────────────────────────────────────────────────
router.get('/rides',                rideCtrl.getRides);
router.get('/rides/search',         rideCtrl.searchRides);

// ── Rides (driver) — MUST be before /:id ──────────────────────────────────
router.get('/rides/my-rides',       authMiddleware, requireRole('driver'), rideCtrl.getMyRides);
router.post('/rides',               authMiddleware, requireRole('driver'), rideCtrl.createRide);

// ── Rides (param routes) ───────────────────────────────────────────────────
router.get('/rides/:id',            rideCtrl.getRide);
router.put('/rides/:id',            authMiddleware, requireRole('driver'), rideCtrl.updateRide);
router.put('/rides/:id/status',     authMiddleware, requireRole('driver'), rideCtrl.updateRideStatus);
router.put('/rides/:id/cancel',     authMiddleware, requireRole('driver'), rideCtrl.cancelRide);
router.delete('/rides/:id',         authMiddleware, requireRole('driver'), rideCtrl.deleteRide);
router.get('/rides/:rideId/bookings', authMiddleware, requireRole('driver'), bookingCtrl.getRideBookings);

// ── Bookings (passenger) ───────────────────────────────────────────────────
router.post('/bookings',                       authMiddleware, requireRole('passenger'), bookingCtrl.createBooking);
router.get('/bookings/my-bookings',            authMiddleware, requireRole('passenger'), bookingCtrl.getMyBookings);
router.get('/bookings/waitlist/:rideId',       authMiddleware, bookingCtrl.getWaitlistPosition);
router.put('/bookings/:id/cancel',             authMiddleware, requireRole('passenger'), bookingCtrl.cancelBooking);
router.put('/bookings/:id/accept',             authMiddleware, requireRole('driver'),    bookingCtrl.acceptBooking);
router.put('/bookings/:id/reject',             authMiddleware, requireRole('driver'),    bookingCtrl.rejectBooking);

// ── Messages ───────────────────────────────────────────────────────────────
router.get('/messages/unread',              authMiddleware, msgCtrl.getUnreadCount);
router.get('/messages/:bookingId',          authMiddleware, msgCtrl.getMessages);
router.post('/messages/:bookingId',         authMiddleware, msgCtrl.sendMessage);

// ── Ratings ────────────────────────────────────────────────────────────────
router.post('/ratings',                     authMiddleware, ratingCtrl.createRating);
router.get('/ratings/user/:userId',         ratingCtrl.getUserRatings);
router.get('/ratings/check/:bookingId',     authMiddleware, ratingCtrl.checkRated);

// ── Reports ────────────────────────────────────────────────────────────────
router.post('/reports',                     authMiddleware, reportCtrl.createReport);
router.get('/reports/my',                   authMiddleware, reportCtrl.getMyReports);

// ── Admin ──────────────────────────────────────────────────────────────────
router.get('/admin/stats',                  authMiddleware, requireAdmin, adminCtrl.getStats);
router.get('/admin/users',                  authMiddleware, requireAdmin, adminCtrl.getUsers);
router.get('/admin/users/:id',              authMiddleware, requireAdmin, adminCtrl.getUserDetail);
router.put('/admin/users/:id/ban',          authMiddleware, requireAdmin, adminCtrl.banUser);
router.put('/admin/users/:id/unban',        authMiddleware, requireAdmin, adminCtrl.unbanUser);
router.get('/admin/rides',                  authMiddleware, requireAdmin, adminCtrl.getRides);
router.put('/admin/rides/:id/cancel',       authMiddleware, requireAdmin, adminCtrl.adminCancelRide);
router.get('/admin/bookings',               authMiddleware, requireAdmin, adminCtrl.getBookings);
router.put('/admin/bookings/:id/cancel',    authMiddleware, requireAdmin, adminCtrl.adminCancelBooking);
router.get('/admin/reports',                authMiddleware, requireAdmin, adminCtrl.getReports);
router.put('/admin/reports/:id/resolve',    authMiddleware, requireAdmin, adminCtrl.resolveReport);

module.exports = router;
