import { useState, useEffect } from 'react';
import api from '../services/api';
import '../styles/PromptQuizPage.css';

const PromptQuizPage = () => {
  const [prompt, setPrompt] = useState('');
  const [quiz, setQuiz] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showResults, setShowResults] = useState(false);
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [questionResults, setQuestionResults] = useState([]);
  const [quizHistory, setQuizHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Check if user is authenticated
  useEffect(() => {
    const token = localStorage.getItem('token');
    setIsAuthenticated(!!token);
  }, []);

  // Fetch quiz history on component mount if authenticated
  useEffect(() => {
    const fetchQuizHistory = async () => {
      if (!isAuthenticated) return;
      
      try {
        const response = await api.get('/prompt-quiz/history');
        setQuizHistory(response.data.data);
      } catch (error) {
        console.error('Error fetching quiz history:', error);
      }
    };

    fetchQuizHistory();
  }, [isAuthenticated]);

  const getCurrentDate = () => {
    const date = new Date();
    return date.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  const handlePromptSubmit = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    try {
      setIsLoading(true);
      setError(null);
      const response = await api.post('/ai/generate-prompt-quiz', { prompt });
      
      if (response.data && response.data.questions) {
        setQuiz(response.data);
      } else {
        console.error('Unexpected quiz data format:', response.data);
        setError('Failed to generate quiz. Please try again.');
      }
      
      setSelectedAnswer(null);
      setCurrentQuestion(0);
      setShowResults(false);
      setScore(0);
      setFeedback('');
      setQuestionResults([]);
    } catch (err) {
      console.error('Error generating quiz:', err);
      setError('Failed to generate quiz. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnswerSelect = (answerIndex) => {
    setSelectedAnswer(answerIndex);
  };

  const handleNextQuestion = () => {
    if (selectedAnswer === null) return;

    const currentQuestionData = quiz.questions[currentQuestion];
    const isCorrect = selectedAnswer === currentQuestionData.correctAnswer;
    
    // Update question results
    const newQuestionResults = [...questionResults];
    newQuestionResults[currentQuestion] = {
      question: currentQuestionData.question,
      options: currentQuestionData.options,
      selectedAnswer,
      correctAnswer: currentQuestionData.correctAnswer,
      isCorrect
    };
    setQuestionResults(newQuestionResults);

    if (isCorrect) {
      setScore(prev => prev + 1);
    }

    if (currentQuestion < quiz.questions.length - 1) {
      setCurrentQuestion(prev => prev + 1);
      setSelectedAnswer(null);
    } else {
      const finalScore = isCorrect ? score + 1 : score;
      const percentage = (finalScore / quiz.questions.length) * 100;
      
      let feedbackText = '';
      if (percentage >= 80) {
        feedbackText = 'Excellent! You have demonstrated mastery of this subject matter.';
      } else if (percentage >= 60) {
        feedbackText = 'Good show! You have a firm grasp of the essential concepts.';
      } else if (percentage >= 40) {
        feedbackText = 'Fair effort! You understand some key points, though further study is recommended.';
      } else {
        feedbackText = 'Continue your studies! A review of the material would be most beneficial.';
      }

      if (isAuthenticated) {
        const saveQuizResults = async () => {
          try {
            const token = localStorage.getItem('token');
            if (!token) {
              console.error('No authentication token found');
              return;
            }
            
            // Ensure we have all 5 questions
            if (!quiz.questions || quiz.questions.length !== 5) {
              console.error('Invalid number of questions:', quiz.questions?.length);
              throw new Error('Quiz must have exactly 5 questions');
            }
            
            // Create quiz data with complete question information
            const quizData = {
              prompt,
              questions: quiz.questions.map((q, index) => ({
                question: q.question,
                options: q.options,
                correctAnswer: q.correctAnswer,
                selectedAnswer: newQuestionResults[index].selectedAnswer,
                isCorrect: newQuestionResults[index].isCorrect
              })),
              score: finalScore,
              totalQuestions: 5,
              feedback: feedbackText
            };
            
            console.log('Saving quiz data:', quizData);
            const response = await api.post('/prompt-quiz/save', quizData);
            
            if (response.data && response.data.success && response.data.data) {
              console.log('Quiz saved successfully:', response.data.data);
              setQuizHistory(prev => [response.data.data, ...prev]);
            } else {
              console.error('Failed to save quiz:', response.data);
              throw new Error('Failed to save quiz');
            }
          } catch (error) {
            console.error('Error saving quiz results:', error);
            setError('Failed to save quiz results. Please try again.');
          }
        };

        saveQuizResults();
      }
      
      setShowResults(true);
      setFeedback(feedbackText);
    }
  };

  const handleRestart = () => {
    setQuiz(null);
    setPrompt('');
    setCurrentQuestion(0);
    setSelectedAnswer(null);
    setShowResults(false);
    setScore(0);
    setFeedback('');
    setQuestionResults([]);
    setShowHistory(false);
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
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

  if (showHistory) {
    return (
      <div className="prompt-quiz-page">
        <h1>The Daily Examiner</h1>
        <p style={{ textAlign: 'center', fontStyle: 'italic', marginBottom: '1rem' }}>
          {getCurrentDate()}
        </p>
        <div className="history-container">
          <h2>Examination Archives</h2>
          <button className="back-button" onClick={() => setShowHistory(false)}>
            Return to Examination
          </button>
          
          {quizHistory.length === 0 ? (
            <p className="no-history">No examination records available in our archives.</p>
          ) : (
            <div className="history-list">
              {quizHistory.map((quiz, index) => (
                <div key={index} className="history-item">
                  <div className="history-header">
                    <h3>Examination #{index + 1}</h3>
                    <span className="history-date">{formatDate(quiz.createdAt)}</span>
                  </div>
                  <p className="history-prompt"><strong>Subject:</strong> {quiz.prompt}</p>
                  <div className="history-score">
                    <span className="score">{quiz.score}</span>
                    <span className="total">/{quiz.totalQuestions}</span>
                  </div>
                  <p className="history-feedback">{quiz.feedback}</p>
                </div>
              ))}
            </div>
          )}
        </div>
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
          
          <div className="action-buttons">
            <button className="restart-button" onClick={handleRestart}>
              Begin New Examination
            </button>
            {isAuthenticated && (
              <button className="history-button" onClick={() => setShowHistory(true)}>
                View Archives
              </button>
            )}
          </div>
        </div>
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