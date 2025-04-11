import React from 'react';
import { Link } from 'react-router-dom';
import '../styles/LandingPage.css';

const LandingPage = () => {
  return (
    <div className="landing-container">
      <header className="hero-section">
        <h1>Smart News Analysis</h1>
        <p>AI-powered credibility scoring and summarization</p>
        <div className="cta-buttons">
          <Link to="/login" className="cta-primary">Get Started</Link>
          <Link to="/features" className="cta-secondary">Learn More</Link>
        </div>
      </header>

      <section className="features-section">
        <div className="feature-card">
          <div className="feature-icon">🔍</div>
          <h3>Credibility Rating</h3>
          <p>NVIDIA NIM analyzes news authenticity with RAG-enhanced verification</p>
        </div>
        
        <div className="feature-card">
          <div className="feature-icon">✍️</div>
          <h3>AI Summarization</h3>
          <p>Instant key-point extraction from long articles</p>
        </div>

        <div className="feature-card">
          <div className="feature-icon">💡</div>
          <h3>Personalized Feed</h3>
          <p>News tailored to your interests and reading history</p>
        </div>
      </section>
    </div>
  );
};

export default LandingPage;