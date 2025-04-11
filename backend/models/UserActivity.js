const mongoose = require('mongoose');

const userActivitySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  articleId: {
    type: String,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true
  },
  source: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  activityType: {
    type: String,
    enum: ['view', 'click', 'read', 'category'],
    required: true
  },
  duration: {
    type: Number,
    default: 0
  },
  completed: {
    type: Boolean,
    default: false
  }
});

module.exports = mongoose.model('UserActivity', userActivitySchema); 