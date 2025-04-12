const mongoose = require('mongoose');
const Quiz = require('../models/Quiz');

// Save quiz results
exports.saveQuiz = async (req, res) => {
  try {
    const { articleId, questions, score, totalQuestions, feedback } = req.body;
    const userId = req.user._id; // Get user ID from auth middleware

    const quiz = new Quiz({
      userId,
      articleId,
      questions,
      score,
      totalQuestions,
      feedback
    });

    await quiz.save();

    res.status(201).json({
      success: true,
      data: quiz
    });
  } catch (error) {
    console.error('Error saving quiz:', error);
    res.status(500).json({
      success: false,
      error: 'Error saving quiz results'
    });
  }
};

// Get user's quiz history
exports.getUserQuizzes = async (req, res) => {
  try {
    const userId = req.user._id; // Get user ID from auth middleware

    const quizzes = await Quiz.find({ userId })
      .sort({ createdAt: -1 })
      .populate('articleId', 'title source category');

    res.status(200).json({
      success: true,
      data: quizzes
    });
  } catch (error) {
    console.error('Error fetching user quizzes:', error);
    res.status(500).json({
      success: false,
      error: 'Error fetching quiz history'
    });
  }
};

// Get quiz statistics
exports.getQuizStats = async (req, res) => {
  try {
    const userId = req.user._id; // Get user ID from auth middleware

    const stats = await Quiz.aggregate([
      { $match: { userId: mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: null,
          totalQuizzes: { $sum: 1 },
          averageScore: { $avg: '$score' },
          highestScore: { $max: '$score' },
          totalQuestions: { $sum: '$totalQuestions' }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: stats[0] || {
        totalQuizzes: 0,
        averageScore: 0,
        highestScore: 0,
        totalQuestions: 0
      }
    });
  } catch (error) {
    console.error('Error fetching quiz stats:', error);
    res.status(500).json({
      success: false,
      error: 'Error fetching quiz statistics'
    });
  }
}; 