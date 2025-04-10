import React from 'react';
import '../styles/FeedbackModal.css';

const FeedbackModal = ({ feedback, onClose }) => {
  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>LLaMA Feedback</h3>
        <p>{feedback}</p>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
};

export default FeedbackModal;
