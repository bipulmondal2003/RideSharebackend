const mongoose = require('mongoose');

const rideSchema = new mongoose.Schema({
  driver:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  from:      { type: String, required: true },
  to:        { type: String, required: true },
  waypoints: [{ type: String }],  // intermediate stops
  date:      { type: Date, required: true },
  time:      { type: String, required: true },

  totalSeats:     { type: Number, required: true, min: 1, max: 8 },
  availableSeats: { type: Number, required: true, min: 0 },

  price: { type: Number, required: true, min: 0 },
  car:   { type: String, required: true },
  notes: { type: String },

  status: {
    type: String,
    enum: ['active', 'started', 'en-route', 'completed', 'cancelled'],
    default: 'active'
  },
  cancellationReason: { type: String },

  // Recurring rides
  recurring: {
    enabled:     { type: Boolean, default: false },
    type:        { type: String, enum: ['daily', 'weekly', 'weekdays'], default: 'weekly' },
    groupId:     { type: String },  // links occurrences together
    occurrences: { type: Number, default: 1 }
  },

  // Waitlist: passengers waiting for a seat
  waitlist: [{
    passenger: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    seats:     { type: Number, default: 1 },
    joinedAt:  { type: Date, default: Date.now }
  }],

  bookings: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Booking' }]
}, { timestamps: true });

module.exports = mongoose.model('Ride', rideSchema);
