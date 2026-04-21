const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name:         { type: String, required: true, trim: true },
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  userType:     { type: String, required: true, enum: ['driver', 'passenger', 'admin'] },

  // Moderation
  isBanned:    { type: Boolean, default: false },
  banReason:   { type: String },
  reportCount: { type: Number, default: 0 },

  // Trust / Rating
  trustScore:   { type: Number, default: 0, min: 0, max: 5 },
  totalRatings: { type: Number, default: 0 },
  ratingSum:    { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
