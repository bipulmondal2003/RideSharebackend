const mongoose = require('mongoose');

const ratingSchema = new mongoose.Schema({
  booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
  ride:    { type: mongoose.Schema.Types.ObjectId, ref: 'Ride', required: true },
  rater:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ratee:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  score:   { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, maxlength: 500, trim: true },
  type:    { type: String, enum: ['passenger-to-driver', 'driver-to-passenger'], required: true },
}, { timestamps: true });

// One rating per direction per booking
ratingSchema.index({ booking: 1, rater: 1 }, { unique: true });

module.exports = mongoose.model('Rating', ratingSchema);
