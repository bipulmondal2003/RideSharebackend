// Socket.io singleton — avoids circular dependency with server.js
let _io = null;

const init = (httpServer) => {
  const { Server } = require('socket.io');
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'secret123';

  _io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
  });

  // Auth middleware — allow unauthenticated connections (for public seat counter)
  _io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (token) {
      try {
        socket.user = jwt.verify(token, JWT_SECRET);
      } catch (_) { /* ignore invalid token */ }
    }
    next();
  });

  _io.on('connection', (socket) => {
    // Join personal room for push notifications
    if (socket.user) {
      socket.join(`user_${socket.user.id}`);
    }

    // Join booking chat room (driver or passenger of that booking)
    socket.on('join_booking_chat', async (bookingId) => {
      if (!socket.user) return;
      try {
        const Booking = require('./models/Booking');
        const booking = await Booking.findById(bookingId).populate('ride');
        if (!booking) return;
        const uid = socket.user.id;
        const driverId = booking.ride?.driver?.toString();
        const passengerId = booking.passenger?.toString();
        if (uid === driverId || uid === passengerId) {
          socket.join(`booking_${bookingId}`);
        }
      } catch (_) {}
    });

    socket.on('leave_booking_chat', (bookingId) => {
      socket.leave(`booking_${bookingId}`);
    });
  });

  return _io;
};

const getIO = () => _io;

module.exports = { init, getIO };
