import React, { useState } from 'react';
import '../styles/FeedbackModal.css';

const FeedbackModal = ({ onSubmit, onClose }) => {
  const [feedback, setFeedback] = useState('');
  const [rating, setRating] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!feedback.trim() || rating === 0) return;
    
    setIsSubmitting(true);
    onSubmit({ feedback, rating });
  };

  const handleRatingClick = (value) => {
    setRating(value);
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>Provide Your Feedback</h3>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Rate this article:</label>
            <div className="rating-container">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`rating-star ${value <= rating ? 'active' : ''}`}
                  onClick={() => handleRatingClick(value)}
                >
                  ★
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="feedback">Your feedback on this article:</label>
            <textarea
              id="feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Share your thoughts on the article's credibility, bias, or factual accuracy..."
              rows="6"
              required
            ></textarea>
          </div>
          <div className="modal-actions">
            <button 
              type="button" 
              className="cancel-button" 
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="submit-button"
              disabled={isSubmitting || !feedback.trim() || rating === 0}
            >
              {isSubmitting ? 'Submitting...' : 'Submit Feedback'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default FeedbackModal;
