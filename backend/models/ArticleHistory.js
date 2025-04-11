const mongoose = require('mongoose');

const articleHistorySchema = new mongoose.Schema({
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
  source: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true,
    default: 'general'
  },
  lastViewed: {
    type: Date,
    default: Date.now
  },
  quizAttempted: {
    type: Boolean,
    default: false
  },
  quizScore: {
    type: Number,
    default: null
  },
  viewCount: {
    type: Number,
    default: 1
  }
}, {
  timestamps: true
});

// Compound index to ensure unique article per user
articleHistorySchema.index({ userId: 1, articleId: 1 }, { unique: true });

module.exports = mongoose.model('ArticleHistory', articleHistorySchema); 