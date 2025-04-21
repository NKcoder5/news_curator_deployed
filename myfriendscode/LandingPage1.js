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
      description: "Our LLaMA3 model analyzes news authenticity with RAG-enhanced verification, checking sources and cross-referencing facts.",
      color: "#003366",
      bgColor: "#e6f0fa"
    },
    {
      title: "Intelligent Summarization",
      description: "Get instant key-point extraction from long articles, saving you time while ensuring you don't miss crucial information.",
      color: "#5e35b1",
      bgColor: "#f3e5f5"
    },
    {
      title: "Personalized Feed",
      description: "Experience news tailored to your interests and reading history with our adaptive recommendation engine.",
      color: "#0277bd",
      bgColor: "#e1f5fe"
    },
    {
      title: "Breaking News Alerts",
      description: "Stay informed with customizable notifications on topics that matter most to you.",
      color: "#2e7d32",
      bgColor: "#e8f5e9"
    },
    {
      title: "Source Verification",
      description: "Trace information back to its origin with our comprehensive source verification system.",
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
            <Link to="/signup" className="cta-primary btn-animated">Start Free Trial</Link>
            <Link to="/signup" className="cta-secondary btn-animated">Get Started</Link>
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
            <Link to="/features/speed" className="card-link">Learn more →</Link>
          </div>
          
          <div className="feature-card">
            <div className="card-header">
              <div className="feature-icon">🛡️</div>
              <h3>Enhanced Fact Checking</h3>
            </div>
            <p>Our AI identifies potential misinformation and cross-references multiple sources</p>
            <Link to="/features/factcheck" className="card-link">Learn more →</Link>
          </div>
          
          <div className="feature-card">
            <div className="card-header">
              <div className="feature-icon">🎯</div>
              <h3>Tailored Experience</h3>
            </div>
            <p>Receive news that matters to you without the noise and information overload</p>
            <Link to="/features/per
            sonalization" className="card-link">Learn more →</Link>
          </div>
          
          <div className="feature-card">
            <div className="card-header">
              <div className="feature-icon">📱</div>
              <h3>Cross-platform Access</h3>
            </div>
            <p>Access your news feed from any device with our responsive web app and native mobile applications</p>
            <Link to="/features/devices" className="card-link">Learn more →</Link>
          </div>
        </div>
      </section>
      
      {/* How It Works Section */}
      <section id="how-it-works" className="how-it-works">
        <h2 className="section-title">How It Works</h2>
        <div className={`process-cards ${isVisible.howItWorks ? 'fade-in' : ''}`}>
          <div className="process-card">
            <div className="step-number">1</div>
            <h3>Connect Sources</h3>
            <p>Add your favorite news sites, blogs and social media feeds</p>
          </div>
          
          <div className="process-connector">
            <div className="connector-dot"></div>
          </div>
          
          <div className="process-card">
            <div className="step-number">2</div>
            <h3>AI Analysis</h3>
            <p>Our system processes content and evaluates credibility</p>
          </div>
          
          <div className="process-connector">
            <div className="connector-dot"></div>
          </div>
          
          <div className="process-card">
            <div className="step-number">3</div>
            <h3>Personalized Delivery</h3>
            <p>Receive smart summaries tailored to your interests</p>
          </div>
          
          <div className="process-connector">
            <div className="connector-dot"></div>
          </div>
          
          <div className="process-card">
            <div className="step-number">4</div>
            <h3>Stay Informed</h3>
            <p>Access insights and credibility scores on any device</p>
          </div>
        </div>
      </section>
      
      {/* Call To Action Section */}
      <section id="cta-section" className={`cta-section ${isVisible.cta ? 'zoom-in' : ''}`}>
        <h2>Start Your Free Trial Today</h2>
        <p>Join thousands of informed readers who trust our AI-powered news analysis</p>
        <Link to="/signup" className="cta-primary btn-animated large btn-pulse">Get Started - Free for 14 Days</Link>
        <p className="no-credit-card">No credit card required</p>
      </section>
      
      {/* Footer */}
      <footer className="footer">
        <div className="footer-grid">
          <div className="footer-column">
            <h3>Smart News Analysis</h3>
            <p>AI-powered credibility scoring and summarization for the modern reader</p>
            <div className="social-icons">
              <a href="https://twitter.com/" className="social-icon" aria-label="Twitter">
                <i className="fab fa-twitter"></i>
              </a>
              <a href="https://facebook.com/" className="social-icon" aria-label="Facebook">
                <i className="fab fa-facebook-f"></i>
              </a>
              <a href="https://linkedin.com/" className="social-icon" aria-label="LinkedIn">
                <i className="fab fa-linkedin-in"></i>
              </a>
            </div>
          </div>
          
          <div className="footer-column">
            <h4>Product</h4>
            <Link to="/features">Features</Link>
            <Link to="/pricing">Pricing</Link>
            <Link to="/testimonials">Testimonials</Link>
            <Link to="/faq">FAQ</Link>
          </div>
          
          <div className="footer-column">
            <h4>Resources</h4>
            <Link to="/blog">Blog</Link>
            <Link to="/guides">Guides</Link>
            <Link to="/api">API</Link>
            <Link to="/support">Support</Link>
          </div>
          
          <div className="footer-column">
            <h4>Company</h4>
            <Link to="/about">About Us</Link>
            <Link to="/careers">Careers</Link>
            <Link to="/press">Press</Link>
            <Link to="/contact">Contact</Link>
          </div>
        </div>
        
        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} Smart News Analysis. All rights reserved.</p>
          <div className="footer-links">
            <Link to="/terms">Terms</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/cookies">Cookies</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;