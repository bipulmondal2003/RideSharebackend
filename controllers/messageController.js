const Message = require('../models/Message');
const Booking = require('../models/Booking');
const Ride = require('../models/Ride');
const { getIO } = require('../socket');

// Verify user has access to this booking's chat
async function verifyBookingAccess(bookingId, userId) {
  try {
    const booking = await Booking.findById(bookingId).populate('ride', 'driver');
    if (!booking) {
      return { valid: false, error: 'Booking not found' };
    }
    
    const isPassenger = booking.passenger.toString() === userId;
    const isDriver = booking.ride?.driver?.toString() === userId;
    
    if (!isPassenger && !isDriver) {
      return { 
        valid: false, 
        error: 'You are not part of this booking',
        code: 403 
      };
    }

    return { 
      valid: true,
      booking,
      otherId: isPassenger ? booking.ride.driver._id : booking.passenger._id,
      userRole: isPassenger ? 'passenger' : 'driver'
    };
  } catch (err) {
    console.error('❌ Booking access verification error:', err);
    return { valid: false, error: 'Access verification failed' };
  }
}

// GET all messages for a booking
exports.getMessages = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;

    const access = await verifyBookingAccess(bookingId, userId);
    if (!access.valid) {
      return res.status(access.code || 400).json({ error: access.error });
    }

    const messages = await Message.find({ booking: bookingId })
      .populate('sender', 'name email userType')
      .populate('receiver', 'name email')
      .sort({ createdAt: 1 })
      .lean();

    await Message.updateMany(
      { booking: bookingId, receiver: userId, readAt: null },
      { readAt: new Date() }
    );

    res.json({
      success: true,
      messages,
      bookingInfo: {
        bookingId: access.booking._id,
        otherId: access.otherId,
        userRole: access.userRole
      }
    });
  } catch (err) {
    console.error('❌ GET messages error:', err);
    res.status(500).json({ error: 'Failed to load messages' });
  }
};

// POST send a message
exports.sendMessage = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { content } = req.body;
    const senderId = req.user.id;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Message content is required' });
    }

    const trimmedContent = content.trim();
    
    if (trimmedContent.length === 0) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    if (trimmedContent.length > 1000) {
      return res.status(400).json({ error: 'Message too long (max 1000 chars)' });
    }

    const access = await verifyBookingAccess(bookingId, senderId);
    if (!access.valid) {
      return res.status(access.code || 400).json({ error: access.error });
    }

    const booking = await Booking.findById(bookingId).populate('ride');
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const message = await Message.create({
      booking: bookingId,
      ride: booking.ride._id,
      sender: senderId,
      receiver: access.otherId,
      content: trimmedContent,
      readAt: null
    });

    await message.populate('sender', 'name userType');

    const io = getIO();
    if (io) {
      io.to(`booking_${bookingId}`).emit('message_created', {
        _id: message._id,
        booking: message.booking,
        sender: {
          _id: message.sender._id,
          name: message.sender.name,
          userType: message.sender.userType
        },
        receiver: message.receiver,
        content: message.content,
        createdAt: message.createdAt,
        readAt: null
      });

      io.to(`user_${access.otherId}`).emit('new_message_notification', {
        bookingId,
        senderName: req.user.name,
        preview: trimmedContent.substring(0, 50),
        timestamp: new Date()
      });
    }

    res.status(201).json({ success: true, message });
  } catch (err) {
    console.error('❌ POST message error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
};

// GET unread message count
exports.getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;
    const unreadCount = await Message.countDocuments({
      receiver: userId,
      readAt: null
    });

    res.json({ success: true, unread: unreadCount });
  } catch (err) {
    console.error('❌ Unread count error:', err);
    res.status(500).json({ error: 'Failed to get unread count', unread: 0 });
  }
};

// Mark message as read
exports.markAsRead = async (req, res) => {
  try {
    const { messageId } = req.params;
    const message = await Message.findByIdAndUpdate(
      messageId,
      { readAt: new Date() },
      { new: true }
    ).lean();

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const io = getIO();
    if (io) {
      io.emit('message_read', { messageId, readAt: message.readAt });
    }

    res.json({ success: true, message });
  } catch (err) {
    console.error('❌ Mark as read error:', err);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
};
