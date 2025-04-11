import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import '../styles/PromptQuizPage.css';

const PromptQuizPage = () => {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [quiz, setQuiz] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [score, setScore] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [questionResults, setQuestionResults] = useState([]);

  const handlePromptSubmit = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setIsLoading(true);
    setError('');

    try {
      const response = await api.post('/ai/generate-prompt-quiz', { prompt });
      setQuiz(response.data);
      setCurrentQuestion(0);
      setSelectedAnswer(null);
      setScore(0);
      setShowResults(false);
      setFeedback('');
      setQuestionResults([]);
    } catch (err) {
      setError('Failed to generate quiz. Please try again.');
      console.error('Error generating quiz:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnswerSelect = (answer) => {
    // Make sure we're working with a number
    const index = Number(answer);
    
    // Set the selected answer
    setSelectedAnswer(index);
    
    // Log for debugging
    console.log(`Selected answer ${index} for question ${currentQuestion}`);
  };

  const handleNextQuestion = () => {
    // Check if selectedAnswer is null or undefined, not just falsy
    if (selectedAnswer === null || selectedAnswer === undefined) return;

    const isCorrect = selectedAnswer === quiz.questions[currentQuestion].correctAnswer;
    const newScore = score + (isCorrect ? 1 : 0);
    setScore(newScore);

    // Store question result
    const results = [...questionResults];
    results.push({
      question: quiz.questions[currentQuestion].question,
      selectedAnswer,
      correctAnswer: quiz.questions[currentQuestion].correctAnswer,
      isCorrect,
    });
    setQuestionResults(results);

    if (currentQuestion < quiz.questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
      setSelectedAnswer(null); // Reset to null instead of empty string
    } else {
      // Generate feedback based on score
      let feedbackText = '';
      const percentage = (newScore / quiz.questions.length) * 100;
      
      if (percentage >= 80) {
        feedbackText = 'Excellent! You have a great understanding of this topic.';
      } else if (percentage >= 60) {
        feedbackText = 'Good job! You have a good grasp of the main concepts.';
      } else if (percentage >= 40) {
        feedbackText = 'Not bad! You understand some key points, but there\'s room for improvement.';
      } else {
        feedbackText = 'Keep learning! Review the material and try again.';
      }
      
      setFeedback(feedbackText);
      setShowResults(true);
    }
  };

  const handleRestart = () => {
    setQuiz(null);
    setPrompt('');
    setCurrentQuestion(0);
    setSelectedAnswer(null);
    setScore(0);
    setShowResults(false);
    setFeedback('');
    setQuestionResults([]);
  };

  if (isLoading) {
    return (
      <div className="prompt-quiz-page">
        <div className="loading-state">
          <div className="spinner"></div>
          <p className="loading-text">Generating quiz...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="prompt-quiz-page">
        <div className="error-message">{error}</div>
        <button className="restart-button" onClick={handleRestart}>
          Try Again
        </button>
      </div>
    );
  }

  if (!quiz) {
    return (
      <div className="prompt-quiz-page">
        <h1>Create Your Own Quiz</h1>
        <p className="quiz-description">
          Enter any topic or question, and our AI will generate a quiz to test your knowledge.
          The quiz will use RAG (Retrieval-Augmented Generation) to provide relevant context.
        </p>
        <form onSubmit={handlePromptSubmit} className="prompt-form">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Enter your topic or question to generate a quiz..."
            className="prompt-input"
            rows={4}
          />
          <button type="submit" className="submit-button">
            Generate Quiz
          </button>
        </form>
      </div>
    );
  }

  if (showResults) {
    return (
      <div className="prompt-quiz-page">
        <div className="results-container">
          <h2>Quiz Results</h2>
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
            Create New Quiz
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="prompt-quiz-page">
      <div className="quiz-container">
        <h2>Question {currentQuestion + 1} of {quiz.questions.length}</h2>
        <div className="question-container">
          <p className="question">{quiz.questions[currentQuestion].question}</p>
          <div className="answers-container">
            {quiz.questions[currentQuestion].options.map((option, index) => (
              <button
                key={index}
                className={`answer-button ${selectedAnswer === index ? 'selected' : ''}`}
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
          disabled={selectedAnswer === null}
        >
          {currentQuestion === quiz.questions.length - 1 ? 'Finish' : 'Next Question'}
        </button>
      </div>
    </div>
  );
};

export default PromptQuizPage; 