const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reported: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ride:     { type: mongoose.Schema.Types.ObjectId, ref: 'Ride' },
  reason: {
    type: String,
    required: true,
    enum: ['inappropriate_behavior', 'no_show', 'safety_concern', 'fraud', 'rude', 'other']
  },
  details:   { type: String, maxlength: 1000 },
  status:    { type: String, enum: ['pending', 'reviewed', 'actioned', 'dismissed'], default: 'pending' },
  adminNote: { type: String },
  resolvedAt: { type: Date },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('Report', reportSchema);
