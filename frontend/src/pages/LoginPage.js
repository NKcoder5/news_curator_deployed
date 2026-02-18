import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Mail, Lock, AlertCircle } from 'lucide-react';
import '../styles/LoginPage.css';

const BASE_URL = 'https://news-curator-deployed.onrender.com';

const LoginPage = ({ setUser }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isUnfolded, setIsUnfolded] = useState(false);
  const [animationStage, setAnimationStage] = useState(0);
  const navigate = useNavigate();

  // Improved animation sequence that mimics newspaper unfolding
  useEffect(() => {
    // Start displaying container
    setAnimationStage(1);

    // Create a sequence of animations with proper timing for newspaper unfolding effect
    const timer1 = setTimeout(() => setIsUnfolded(true), 800);
    const timer2 = setTimeout(() => setAnimationStage(2), 1800);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, []);

  // Check viewport dimensions and adjust content if needed
  useEffect(() => {
    const handleResize = () => {
      const vh = window.innerHeight;
      document.documentElement.style.setProperty('--viewport-height', `${vh}px`);
    };

    // Initial call and event listener
    handleResize();
    window.addEventListener('resize', handleResize);

    // Clean up
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

    setIsLoading(true);

    try {
      const res = await axios.post(`${BASE_URL}/api/auth/login`, {
        email,
        password,
      });

      localStorage.setItem('token', res.data.token);
      setUser({ token: res.data.token });
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  // Headlines for newspaper pages - reduced to ensure they fit
  const headlines = [
    "BREAKING NEWS",
    "LOCAL UPDATES",
    "WORLD REPORT",
    "TECH TRENDS"
  ];

  return (
    <div className={`login-container stage-${animationStage}`}>
      <div className="paper-texture"></div>

      <div className="background-grid">
        {/* Grid pattern for depth - reduced number for performance */}
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={`h-${i}`} className="grid-line horizontal" style={{ top: `${i * 10}%` }}></div>
        ))}
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={`v-${i}`} className="grid-line vertical" style={{ left: `${i * 10}%` }}></div>
        ))}
      </div>

      <div className="login-background">
        {/* Large decorative newspaper */}
        <div className="decorative-newspaper">
          <div className="decorative-header"></div>
          <div className="decorative-column left"></div>
          <div className="decorative-column center"></div>
          <div className="decorative-column right"></div>
        </div>

        {/* Floating newspaper pages with headlines - positioned for better fit */}
        <div className="page-layer page-layer-1">
          <div className="page-content">
            <h3 className="page-headline">{headlines[0]}</h3>
            <div className="page-text-line"></div>
            <div className="page-text-line"></div>
            <div className="page-text-line short"></div>
          </div>
        </div>
        <div className="page-layer page-layer-2">
          <div className="page-content">
            <h3 className="page-headline">{headlines[1]}</h3>
            <div className="page-text-line"></div>
            <div className="page-text-line"></div>
            <div className="page-text-line short"></div>
          </div>
        </div>
        <div className="page-layer page-layer-3">
          <div className="page-content">
            <h3 className="page-headline">{headlines[2]}</h3>
            <div className="page-text-line"></div>
            <div className="page-text-line"></div>
            <div className="page-text-line short"></div>
          </div>
        </div>
        <div className="page-layer page-layer-4">
          <div className="page-content">
            <h3 className="page-headline">{headlines[3]}</h3>
            <div className="page-text-line"></div>
            <div className="page-text-line"></div>
            <div className="page-text-line short"></div>
          </div>
        </div>

        {/* Newspaper elements - positioned strategically to avoid overflow */}
        <div className="floating-element newspaper">📰</div>
        <div className="floating-element pen">🖋️</div>
        <div className="floating-element calendar">📅</div>
        <div className="floating-element bell">🔔</div>
        <div className="floating-element coffee">☕</div>
        <div className="floating-element glasses">👓</div>
        <div className="floating-element ink">🖨️</div>
        <div className="floating-element book">📚</div>
      </div>

      <div className={`login-form ${isUnfolded ? 'unfolded' : ''}`}>
        <div className="newspaper-border"></div>
        <div className="login-header">
          <div className="masthead">
            <h1 className="login-title">PURE PRESS</h1>
            <div className="date-line">
              <span className="date">
                {new Date().toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                }).toUpperCase()}
              </span>
              <span className="edition">MORNING EDITION</span>
            </div>
          </div>
          <p className="login-subtitle">ACCOUNT ACCESS - SUBSCRIBER LOGIN</p>
        </div>

        {error && (
          <div className="error-message">
            <AlertCircle className="error-icon" />
            <span>{error}</span>
          </div>
        )}

        <form className="form" onSubmit={handleSubmit}>
          <fieldset className="form-fieldset">
            <div className="form-group">
              <label htmlFor="email" className="form-label">
                EMAIL ADDRESS
              </label>
              <div className="input-container">
                <div className="input-icon">
                  <Mail className="icon" />
                </div>
                <input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="input-field"
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="password" className="form-label">
                PASSWORD
              </label>
              <div className="input-container">
                <div className="input-icon">
                  <Lock className="icon" />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="input-field"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="toggle-button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="icon" /> : <Eye className="icon" />}
                </button>
              </div>
            </div>
          </fieldset>

          <div className="form-actions">
            <button type="submit" disabled={isLoading} className="submit-button">
              {isLoading ? (
                <>
                  <div className="spinner"></div>
                  PROCESSING...
                </>
              ) : (
                <>
                  <span className="button-icon">🗞️</span> READ NOW
                </>
              )}
            </button>
            <div className="signup-link">
              <p>
                <span className="signup-prefix">FIRST TIME READER?</span>{' '}
                <a href="/signup" className="signup-anchor">
                  SUBSCRIBE HERE <span className="arrow">→</span>
                </a>
              </p>
            </div>
          </div>
        </form>

        <div className="paper-fold"></div>
        <div className="paper-stamp">VERIFIED</div>
      </div>
    </div>
  );
};

export default LoginPage;