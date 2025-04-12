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
    const index = Number(answer);
    setSelectedAnswer(index);
    console.log(`Selected answer ${index} for question ${currentQuestion}`);
  };

  const handleNextQuestion = () => {
    if (selectedAnswer === null || selectedAnswer === undefined) return;

    const isCorrect = selectedAnswer === quiz.questions[currentQuestion].correctAnswer;
    const newScore = score + (isCorrect ? 1 : 0);
    setScore(newScore);

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
      setSelectedAnswer(null);
    } else {
      let feedbackText = '';
      const percentage = (newScore / quiz.questions.length) * 100;
      
      if (percentage >= 80) {
        feedbackText = 'Excellent! You have demonstrated mastery of this subject matter.';
      } else if (percentage >= 60) {
        feedbackText = 'Good show! You have a firm grasp of the essential concepts.';
      } else if (percentage >= 40) {
        feedbackText = 'Fair effort! You understand some key points, though further study is recommended.';
      } else {
        feedbackText = 'Continue your studies! A review of the material would be most beneficial.';
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

  const getCurrentDate = () => {
    const date = new Date();
    return date.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  if (isLoading) {
    return (
      <div className="prompt-quiz-page">
        <div className="loading-state">
          <div className="spinner"></div>
          <p className="loading-text">Compiling your examination...</p>
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
        <h1>The Daily Examiner</h1>
        <p style={{ textAlign: 'center', fontStyle: 'italic', marginBottom: '1rem' }}>
          {getCurrentDate()}
        </p>
        <p className="quiz-description">
          Enter any topic of interest, and our modern typesetting machines shall generate a thorough examination 
          to test your knowledge and wisdom. Our editors employ the latest Retrieval-Augmented Generation 
          technologies to ensure accuracy and relevance in all questions posed.
        </p>
        <form onSubmit={handlePromptSubmit} className="prompt-form">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Kindly enter your subject of inquiry..."
            className="prompt-input"
            rows={4}
          />
          <button type="submit" className="submit-button">
            Compose Examination
          </button>
        </form>
      </div>
    );
  }

  if (showResults) {
    return (
      <div className="prompt-quiz-page">
        <h1>The Daily Examiner</h1>
        <p style={{ textAlign: 'center', fontStyle: 'italic', marginBottom: '1rem' }}>
          {getCurrentDate()}
        </p>
        <div className="results-container">
          <h2>Examination Results</h2>
          <div className="score-display">
            <span className="score">{score}</span>
            <span className="total">/{quiz.questions.length}</span>
          </div>
          <p className="feedback">{feedback}</p>
          
          <div className="question-results">
            <h3>Detailed Analysis</h3>
            {questionResults.map((result, index) => (
              <div key={index} className={`question-result ${result.isCorrect ? 'correct' : 'incorrect'}`}>
                <div className="question-header">
                  <span className="question-number">Inquiry {index + 1}</span>
                  <span className={`status ${result.isCorrect ? 'correct' : 'incorrect'}`}>
                    {result.isCorrect ? '✓ Correct' : '✗ Incorrect'}
                  </span>
                </div>
                <p className="question-text">{result.question}</p>
                <div className="answer-details">
                  <p className="selected-answer">
                    Your response: <span className={result.isCorrect ? 'correct' : 'incorrect'}>
                      {quiz.questions[index].options[result.selectedAnswer]}
                    </span>
                  </p>
                  {!result.isCorrect && (
                    <p className="correct-answer">
                      Proper response: <span className="correct">
                        {quiz.questions[index].options[result.correctAnswer]}
                      </span>
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
          
          <button className="restart-button" onClick={handleRestart}>
            Begin New Examination
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="prompt-quiz-page">
      <h1>The Daily Examiner</h1>
      <p style={{ textAlign: 'center', fontStyle: 'italic', marginBottom: '1rem' }}>
        {getCurrentDate()}
      </p>
      <div className="quiz-container">
        <h2>Inquiry {currentQuestion + 1} of {quiz.questions.length}</h2>
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
          {currentQuestion === quiz.questions.length - 1 ? 'Submit Examination' : 'Next Inquiry'}
        </button>
      </div>
    </div>
  );
};

export default PromptQuizPage;