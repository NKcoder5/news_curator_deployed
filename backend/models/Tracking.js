// backend/models/Tracking.js (+ New File)
const mongoose = require('mongoose');

const trackingSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: { 
    type: String, 
    required: true,
    enum: ['click', 'scroll', 'read_time', 'save', 'feedback'] 
  },
  articleId: { type: String, required: true },
  metadata: {
    categories: [String],
    scrollDepth: Number,
    duration: Number,
    feedbackType: String
  },
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Tracking', trackingSchema);