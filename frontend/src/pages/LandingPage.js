import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import '../styles/LandingPage.css';

const LandingPage = () => {
  const [isVisible, setIsVisible] = useState({
    features: false,
    howItWorks: false,
    cta: false,
  });

  // 3D Slider items with different colors and no images
  const sliderItems = [
    {
      title: "Credibility Rating",
      description: "Judges a story by whether independent outlets report the same events and whether its premises match the public record, not by how it is written.",
      color: "#003366",
      bgColor: "#e6f0fa"
    },
    {
      title: "Intelligent Summarization",
      description: "Short and detailed summaries written from the full article, not the two-line preview in the feed.",
      color: "#5e35b1",
      bgColor: "#f3e5f5"
    },
    {
      title: "Personalized Feed",
      description: "A front page that learns which sections you read most and leads with them.",
      color: "#0277bd",
      bgColor: "#e1f5fe"
    },
    {
      title: "Check Anything",
      description: "Paste a link, a forwarded message, a screenshot or a YouTube video and get a verdict: real, fake or cannot verify.",
      color: "#2e7d32",
      bgColor: "#e8f5e9"
    },
    {
      title: "Publisher Check",
      description: "Recognises over 11,500 rated news sites by their web address, and flags pages that pose as a known newsroom.",
      color: "#d84315",
      bgColor: "#fbe9e7"
    },
  ];

  // Intersection Observer for scroll animations
  useEffect(() => {
    const observerOptions = {
      threshold: 0.1,
      rootMargin: '0px',
    };

    const observerCallback = (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          switch (entry.target.id) {
            case 'features-section':
              setIsVisible((prev) => ({ ...prev, features: true }));
              break;
            case 'how-it-works':
              setIsVisible((prev) => ({ ...prev, howItWorks: true }));
              break;
            case 'cta-section':
              setIsVisible((prev) => ({ ...prev, cta: true }));
              break;
            default:
              break;
          }
        }
      });
    };

    const observer = new IntersectionObserver(observerCallback, observerOptions);
    const sections = ['features-section', 'how-it-works', 'cta-section']
      .map((id) => document.getElementById(id))
      .filter((el) => el);

    sections.forEach((section) => observer.observe(section));

    return () => {
      sections.forEach((section) => observer.unobserve(section));
    };
  }, []);

  return (
    <div className="landing-container">
      {/* Hero Section */}
      <header className="hero-section">
        <div className="hero-content">
          <h1>Smart News Analysis</h1>
          <p className="hero-subtitle">AI-powered credibility scoring and summarization for the modern reader</p>
          <div className="cta-buttons">
            <Link to="/signup" className="cta-primary btn-animated">Create Free Account</Link>
            <Link to="/login" className="cta-secondary btn-animated">Log In</Link>
          </div>
        </div>
        <div className="hero-image">
          <div className="mockup-container">
            <div className="mockup-screen"></div>
          </div>
        </div>
      </header>
      
      {/* 3D Slider Section */}
      <section className="features-slider">
        <h2 className="section-title">Discover Our Features</h2>
        <div className="slider-container">
          <div 
            className="slider"
            style={{ '--quantity': sliderItems.length }}
          >
            {sliderItems.map((item, index) => (
              <div
                className="slider-item"
                key={index}
                style={{ 
                  '--position': index + 1,
                  '--item-color': item.color,
                  '--item-bg': item.bgColor
                }}
              >
                <div className="slider-content">
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features-section" className="features-section">
        <h2 className="section-title">Key Benefits</h2>
        <div className={`card-grid ${isVisible.features ? 'fade-in' : ''}`}>
          <div className="feature-card">
            <div className="card-header">
              <div className="feature-icon">🚀</div>
              <h3>Faster Information Processing</h3>
            </div>
            <p>Get through more news in less time with our smart summarization technology</p>
            <Link to="/signup" className="card-link">Try it →</Link>
          </div>
          
          <div className="feature-card">
            <div className="card-header">
              <div className="feature-icon">🛡️</div>
              <h3>Enhanced Fact Checking</h3>
            </div>
            <p>Counts independent outlets, not reprints of one wire story, before calling anything confirmed</p>
            <Link to="/signup" className="card-link">Try it →</Link>
          </div>
          
          <div className="feature-card">
            <div className="card-header">
              <div className="feature-icon">🎯</div>
              <h3>Tailored Experience</h3>
            </div>
            <p>Receive news that matters to you without the noise and information overload</p>
            <Link to="/signup" className="card-link">Try it →</Link>
          </div>
          
          <div className="feature-card">
            <div className="card-header">
              <div className="feature-icon">📱</div>
              <h3>Cross-platform Access</h3>
            </div>
            <p>Works in any modern browser, on a laptop or a phone</p>
            <Link to="/signup" className="card-link">Try it →</Link>
          </div>
        </div>
      </section>
      
      {/* How It Works Section */}
      <section id="how-it-works" className="how-it-works">
        <h2 className="section-title">How It Works</h2>
        <div className={`process-cards ${isVisible.howItWorks ? 'fade-in' : ''}`}>
          <div className="process-card">
            <div className="step-number">1</div>
            <h3>Bring a Story</h3>
            <p>Open one from the front page, or paste a link, message, screenshot or video</p>
          </div>
          
          <div className="process-connector">
            <div className="connector-dot"></div>
          </div>
          
          <div className="process-card">
            <div className="step-number">2</div>
            <h3>Weigh the Evidence</h3>
            <p>Other outlets, the public record and four writing checks are weighed separately</p>
          </div>
          
          <div className="process-connector">
            <div className="connector-dot"></div>
          </div>
          
          <div className="process-card">
            <div className="step-number">3</div>
            <h3>Get a Plain Answer</h3>
            <p>Real, fake or cannot verify, with every reason shown</p>
          </div>
          
          <div className="process-connector">
            <div className="connector-dot"></div>
          </div>
          
          <div className="process-card">
            <div className="step-number">4</div>
            <h3>Keep a Record</h3>
            <p>Your dashboard keeps what you have read and what the checks found</p>
          </div>
        </div>
      </section>
      
      {/* Call To Action Section */}
      <section id="cta-section" className={`cta-section ${isVisible.cta ? 'zoom-in' : ''}`}>
        <h2>Check Your First Story</h2>
        <p>Free to use. Sign up and have a verdict in under a minute</p>
        <Link to="/signup" className="cta-primary btn-animated large btn-pulse">Create a Free Account</Link>
        <p className="no-credit-card">No payment details, ever</p>
      </section>
      
      {/* Footer */}
      <footer className="footer">
        <div className="footer-grid">
          <div className="footer-column">
            <h3>Smart News Analysis</h3>
            <p>AI-powered credibility scoring and summarization for the modern reader</p>
          </div>
          
          <div className="footer-column">
            <h4>Use It</h4>
            <Link to="/check">Check Anything</Link>
            <Link to="/home">Front Page</Link>
            <Link to="/compare">Compare Coverage</Link>
            <Link to="/dashboard">Dashboard</Link>
          </div>
          
          <div className="footer-column">
            <h4>Learn</h4>
            <a href="#features-section">Key Benefits</a>
            <a href="#how-it-works">How It Works</a>
          </div>
          
          <div className="footer-column">
            <h4>Account</h4>
            <Link to="/signup">Sign Up</Link>
            <Link to="/login">Log In</Link>
          </div>
        </div>
        
        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} Smart News Analysis. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
