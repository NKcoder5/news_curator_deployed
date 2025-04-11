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

  if (isLoading) {
    return (
      <div className="quiz-page">
        <div className="loading-state">
          <div className="spinner"></div>
          <p className="loading-text">Generating quiz...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="quiz-page">
        <div className="error-message">{error}</div>
        <button className="restart-button" onClick={() => navigate('/home')}>
          Return to Home
        </button>
      </div>
    );
  }

  if (showResults) {
    return (
      <div className="quiz-page">
        <div className="results-container">
          <h2>Quiz Results</h2>
          {articleTitle && <h3 className="article-title">{articleTitle}</h3>}
          <div className="score-display">
            <span className="score">{score}</span>
            <span className="total">/{quiz.questions.length}</span>
          </div>
          <p className="feedback">{feedback}</p>
          
          <div className="question-results">
            <h3>Question Results</h3>
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
    );
  }

  return (
    <div className="quiz-page">
      <div className="quiz-container">
        <h2>Article Quiz</h2>
        {articleTitle && <h3 className="article-title">{articleTitle}</h3>}
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
          {currentQuestion === quiz.questions.length - 1 ? 'Finish' : 'Next Question'}
        </button>
      </div>
    </div>
  );
};

export default QuizPage; 