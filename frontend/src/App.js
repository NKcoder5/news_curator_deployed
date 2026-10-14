import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import ArticlePage from './pages/ArticlePage';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import LandingPage from './pages/LandingPage';
import Dashboard from './pages/Dashboard';
import ComparePage from './pages/ComparePage';
import CheckPage from './pages/CheckPage';
import Navbar from './components/Navbar';
import api from './services/api';
import { shouldClearSession } from './services/session';
import './styles/global.css';
import './styles/newsprint.css';

const App = () => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if user is logged in
    const token = localStorage.getItem('token');
    if (token) {
      // Set initial user state with token
      setUser({ token });
      
      // Verify token and get user data
      api.get('/auth/verify')
        .then(response => {
          setUser({
            token,
            userId: response.data.userId,
            interests: response.data.interests || []
          });
        })
        .catch(error => {
          // See services/session.js: a check that could not run is not a
          // rejected credential, and clearing the token on one signed readers
          // out mid-session every time the backend restarted.
          if (shouldClearSession(error)) {
            localStorage.removeItem('token');
            setUser(null);
            return;
          }
          console.warn('Could not verify the session just now; keeping it.', error.message);
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else {
      setIsLoading(false);
    }
  }, []);

  if (isLoading) {
    return <div className="loading-container">Loading...</div>;
  }

  return (
    <BrowserRouter>
      <Navbar user={user} setUser={setUser} />
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<LandingPage />} />
        <Route 
          path="/login" 
          element={user ? <Navigate to="/home" /> : <LoginPage setUser={setUser} />} 
        />
        <Route 
          path="/signup" 
          element={user ? <Navigate to="/home" /> : <SignupPage setUser={setUser} />} 
        />

        {/* Protected Routes */}
        <Route 
          path="/home" 
          element={user ? <HomePage /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/article" 
          element={user ? <ArticlePage /> : <Navigate to="/login" />} 
        />
        <Route
          path="/dashboard"
          element={user ? <Dashboard /> : <Navigate to="/login" />}
        />
        <Route
          path="/compare"
          element={user ? <ComparePage /> : <Navigate to="/login" />}
        />
        <Route
          path="/check"
          element={user ? <CheckPage /> : <Navigate to="/login" />}
        />

        {/* Fallback Redirect */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;