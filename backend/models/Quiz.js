const mongoose = require('mongoose');

const quizSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  articleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Article',
    required: true
  },
  questions: [{
    question: String,
    options: [String],
    correctAnswer: String,
    selectedAnswer: String,
    isCorrect: Boolean
  }],
  score: {
    type: Number,
    required: true
  },
  totalQuestions: {
    type: Number,
    required: true
  },
  feedback: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Create compound index for userId and articleId
quizSchema.index({ userId: 1, articleId: 1 });

module.exports = mongoose.model('Quiz', quizSchema); 