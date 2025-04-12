import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../services/api';
import '../styles/QuizPage.css';

const QuizPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const detailedSummary = location.state?.detailedSummary;
  const articleTitle = location.state?.articleTitle;

  const [quiz, setQuiz] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showResults, setShowResults] = useState(false);
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [questionResults, setQuestionResults] = useState([]);
  
  // Get current date for newspaper header
  const getCurrentDate = () => {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return new Date().toLocaleDateString('en-US', options);
  };
  
  // Generate volume and issue number for newspaper
  const getVolumeIssue = () => {
    const year = new Date().getFullYear();
    const startYear = 2023; // When the newspaper started
    const volume = year - startYear + 1;
    
    // Calculate issue number (day of year)
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const diff = now - start;
    const oneDay = 1000 * 60 * 60 * 24;
    const issue = Math.floor(diff / oneDay);
    
    return `Vol. ${volume}, No. ${issue}`;
  };

  useEffect(() => {
    if (!detailedSummary) {
      navigate('/home');
      return;
    }

    const generateQuiz = async () => {
      try {
        setIsLoading(true);
        const response = await api.post('/ai/quiz', { detailedSummary });
        setQuiz(response.data.quiz);
        setSelectedAnswers(new Array(response.data.quiz.questions.length).fill(null));
      } catch (err) {
        console.error('Error generating quiz:', err);
        setError('Failed to generate quiz. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    generateQuiz();
  }, [detailedSummary, navigate]);

  const handleAnswerSelect = (answerIndex) => {
    // Make sure we're working with a number
    const index = Number(answerIndex);
    
    // Create a new array with the selected answer
    const newSelectedAnswers = [...selectedAnswers];
    newSelectedAnswers[currentQuestion] = index;
    setSelectedAnswers(newSelectedAnswers);
    
    // Log for debugging
    console.log(`Selected answer ${index} for question ${currentQuestion}`);
  };

  const handleNextQuestion = () => {
    if (selectedAnswers[currentQuestion] === null) return;

    if (currentQuestion < quiz.questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
    } else {
      // Calculate score
      let correctCount = 0;
      const results = [];
      
      quiz.questions.forEach((question, index) => {
        const isCorrect = selectedAnswers[index] === question.correctAnswer;
        if (isCorrect) correctCount++;
        
        results.push({
          question: question.question,
          selectedAnswer: selectedAnswers[index],
          correctAnswer: question.correctAnswer,
          isCorrect
        });
      });
      
      const finalScore = correctCount;
      setScore(finalScore);
      setQuestionResults(results);
      
      // Generate feedback based on score
      let feedbackText = '';
      const percentage = (finalScore / quiz.questions.length) * 100;
      
      if (percentage >= 80) {
        feedbackText = 'Excellent! You have a great understanding of this article.';
      } else if (percentage >= 60) {
        feedbackText = 'Good job! You have a good grasp of the main concepts.';
      } else if (percentage >= 40) {
        feedbackText = 'Not bad! You understand some key points, but there\'s room for improvement.';
      } else {
        feedbackText = 'Keep learning! Review the article and try again.';
      }
      
      setFeedback(feedbackText);
      setShowResults(true);
      
      // Update quiz attempt in article history
      handleQuizComplete(finalScore);
    }
  };

  const handleQuizComplete = async (score) => {
    try {
      await api.post('/article-history/update-quiz', {
        articleId: location.state?.article?.url,
        score: score
      });
    } catch (error) {
      console.error('Error updating quiz attempt:', error);
    }
  };

  const handleRestart = () => {
    setCurrentQuestion(0);
    setSelectedAnswers(new Array(quiz.questions.length).fill(null));
    setShowResults(false);
    setScore(0);
    setFeedback('');
    setQuestionResults([]);
  };

  // Common newspaper header for all states
  const NewspaperHeader = () => (
    <div className="newspaper-header">
      <span className="newspaper-issue">{getVolumeIssue()}</span>
      <span className="newspaper-price">DAILY • COMPLIMENTARY</span>
      <h1 className="newspaper-title">Knowledge Chronicle</h1>
      <p className="newspaper-subtitle">Test your comprehension of the latest news</p>
      <p className="newspaper-date">{getCurrentDate()}</p>
    </div>
  );

  if (isLoading) {
    return (
      <div className="quiz-page">
        <div className="loading-container">
          <NewspaperHeader />
          <div className="loading-content">
            <h2 className="loading-headline">Preparing Your Knowledge Assessment</h2>
            <div className="loading-graphic">
              <div className="spinner"></div>
            </div>
            <p className="loading-text">Your quiz is being typeset...</p>
            <p className="loading-subtext">Our editors are carefully crafting questions based on the article content.</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="quiz-page">
        <div className="error-container">
          <NewspaperHeader />
          <div className="error-content">
            <h2 className="error-headline">PUBLICATION ERROR</h2>
            <div className="error-message">
              {error}
            </div>
            <button className="return-button" onClick={() => navigate('/home')}>
              Return to Front Page
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (showResults) {
    return (
      <div className="quiz-page">
        <div className="results-container">
          <NewspaperHeader />
          
          <div className="results-content">
            <h2 className="article-title">Quiz Results: {articleTitle}</h2>
            <div className="score-display">
              <span className="score">{score}</span>
              <span className="total">/{quiz.questions.length}</span>
            </div>
            <p className="feedback">{feedback}</p>
            
            <div className="question-results">
              <h3>Question Review</h3>
              {questionResults.map((result, index) => (
                <div key={index} className={`question-result ${result.isCorrect ? 'correct' : 'incorrect'}`}>
                  <div className="question-header">
                    <span className="question-number">Question {index + 1}</span>
                    <span className={`status ${result.isCorrect ? 'correct' : 'incorrect'}`}>
                      {result.isCorrect ? '✓ Correct' : '✗ Incorrect'}
                    </span>
                  </div>
                  <p className="question-text">{result.question}</p>
                  <div className="answer-details">
                    <p className="selected-answer">
                      Your answer: <span className={result.isCorrect ? 'correct' : 'incorrect'}>
                        {quiz.questions[index].options[result.selectedAnswer]}
                      </span>
                    </p>
                    {!result.isCorrect && (
                      <p className="correct-answer">
                        Correct answer: <span className="correct">
                          {quiz.questions[index].options[result.correctAnswer]}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            
            <button className="restart-button" onClick={handleRestart}>
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="quiz-page">
      <div className="quiz-container">
        <NewspaperHeader />
        
        <div className="quiz-content">
          <h2 className="article-title">{articleTitle || "Article Quiz"}</h2>
          <div className="question-progress">
            <span>Question {currentQuestion + 1} of {quiz.questions.length}</span>
          </div>
          <div className="question-container">
            <p className="question">{quiz.questions[currentQuestion].question}</p>
            <div className="answers-container">
              {quiz.questions[currentQuestion].options.map((option, index) => (
                <button
                  key={index}
                  className={`answer-button ${selectedAnswers[currentQuestion] === index ? 'selected' : ''}`}
                  onClick={() => handleAnswerSelect(index)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          <button
            className="next-button"
            onClick={handleNextQuestion}
            disabled={selectedAnswers[currentQuestion] === null}
          >
            {currentQuestion === quiz.questions.length - 1 ? 'Submit Answers' : 'Next Question'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuizPage;