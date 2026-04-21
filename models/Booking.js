const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  ride:       { type: mongoose.Schema.Types.ObjectId, ref: 'Ride', required: true },
  passenger:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  seats:      { type: Number, required: true, min: 1, default: 1 },
  seatNumber: { type: Number, required: true },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'cancelled', 'completed', 'waitlisted'],
    default: 'pending'
  },
  cancellationReason: { type: String },
  bookingDate: { type: Date, default: Date.now },
  totalPrice:  { type: Number, required: true },

  // Ratings flags
  driverRated:    { type: Boolean, default: false },
  passengerRated: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('Booking', bookingSchema);
