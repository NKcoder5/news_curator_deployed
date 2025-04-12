const mongoose = require('mongoose');

const articleFeedbackSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  articleId: {
    type: String,
    required: true
  },
  feedback: {
    type: String,
    required: true,
    trim: true
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Compound index to ensure one feedback per article per user
articleFeedbackSchema.index({ userId: 1, articleId: 1 }, { unique: true });

module.exports = mongoose.model('ArticleFeedback', articleFeedbackSchema); 