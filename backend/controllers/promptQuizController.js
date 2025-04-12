const mongoose = require('mongoose');
const PromptQuiz = require('../models/PromptQuiz');

// Save prompt quiz results
const savePromptQuiz = async (req, res) => {
  try {
    console.log('Saving new quiz for user:', req.user._id);
    console.log('Quiz data:', req.body);
    
    const { prompt, questions, score, totalQuestions, feedback } = req.body;
    
    // Validate required fields
    if (!prompt || !questions || score === undefined || !totalQuestions) {
      console.error('Missing required fields');
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }
    
    // Create new quiz document
    const quiz = new PromptQuiz({
      userId: req.user._id,
      prompt,
      questions,
      score,
      totalQuestions,
      feedback
    });
    
    // Save quiz
    const savedQuiz = await quiz.save();
    console.log('Quiz saved successfully:', savedQuiz._id);
    
    return res.status(201).json({
      success: true,
      data: savedQuiz
    });
  } catch (error) {
    console.error('Error saving quiz:', error);
    return res.status(500).json({
      success: false,
      error: 'Error saving quiz'
    });
  }
};

// Get user's quiz history
const getUserPromptQuizzes = async (req, res) => {
  try {
    console.log('Fetching quiz history for user:', req.user._id);
    
    const quizzes = await PromptQuiz.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .select({
        prompt: 1,
        questions: 1,
        score: 1,
        totalQuestions: 1,
        feedback: 1,
        createdAt: 1
      });
    
    console.log(`Found ${quizzes.length} quizzes for user`);
    
    return res.status(200).json({
      success: true,
      data: quizzes
    });
  } catch (error) {
    console.error('Error fetching quiz history:', error);
    return res.status(500).json({
      success: false,
      error: 'Error fetching quiz history'
    });
  }
};

// Get quiz statistics
const getPromptQuizStats = async (req, res) => {
  try {
    console.log('Fetching quiz stats for user:', req.user._id);
    
    const quizzes = await PromptQuiz.find({ userId: req.user._id });
    
    if (quizzes.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          totalQuizzes: 0,
          averageScore: 0,
          totalQuestions: 0,
          correctAnswers: 0
        }
      });
    }
    
    const stats = {
      totalQuizzes: quizzes.length,
      totalQuestions: quizzes.reduce((sum, quiz) => sum + quiz.totalQuestions, 0),
      correctAnswers: quizzes.reduce((sum, quiz) => sum + quiz.score, 0),
      averageScore: 0
    };
    
    stats.averageScore = Math.round((stats.correctAnswers / stats.totalQuestions) * 100);
    
    console.log('Quiz stats calculated:', stats);
    
    return res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching quiz stats:', error);
    return res.status(500).json({
      success: false,
      error: 'Error fetching quiz statistics'
    });
  }
};

module.exports = {
  savePromptQuiz,
  getUserPromptQuizzes,
  getPromptQuizStats
}; 