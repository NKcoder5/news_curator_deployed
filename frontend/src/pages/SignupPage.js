import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import '../styles/Auth.css';

const SignupPage = ({ setUser }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!email || !password || !confirmPassword) {
      setError('Please fill in all fields');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setIsLoading(true);

    try {
      const res = await api.post('/auth/signup', { 
        email, 
        password 
      });
      
      // Store token and user info
      localStorage.setItem('token', res.data.token);
      setUser({ 
        token: res.data.token,
        userId: res.data.userId
      });
      
      // Navigate to home page
      navigate('/home');
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-header">
        <h2>Create Account</h2>
        <p>Get started with your free account</p>
      </div>
      
      {error && <div className="error-message">{error}</div>}

      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="input-group">
          <label htmlFor="email">Email Address</label>
          <input 
            id="email"
            type="email" 
            placeholder="you@example.com" 
            value={email} 
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="input-group">
          <label htmlFor="password">Password</label>
          <input 
            id="password"
            type={showPassword ? "text" : "password"} 
            placeholder="Create a password" 
            value={password} 
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <div className="input-group">
          <label htmlFor="confirmPassword">Confirm Password</label>
          <input 
            id="confirmPassword"
            type={showPassword ? "text" : "password"} 
            placeholder="Confirm your password" 
            value={confirmPassword} 
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>

        <div className="password-actions">
          <div className="show-password" onClick={() => setShowPassword(!showPassword)}>
            <input 
              type="checkbox" 
              checked={showPassword}
              onChange={() => {}}
              style={{ cursor: 'pointer' }}
            />
            <span>Show passwords</span>
          </div>
        </div>

        <button type="submit" className="auth-btn" disabled={isLoading}>
          {isLoading ? (
            <>
              <span className="loading-spinner"></span>
              Creating account...
            </>
          ) : 'Sign Up'}
        </button>
      </form>

      <div className="auth-footer">
        <p>Already have an account? <a href="/login">Log in</a></p>
      </div>
    </div>
  );
};

export default SignupPage;