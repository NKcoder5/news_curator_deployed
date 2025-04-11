import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import ArticlePage from './pages/ArticlePage';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import LandingPage from './pages/LandingPage';
import Navbar from './components/Navbar';
import api from './services/api';
import './styles/global.css';

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
          console.error('Token verification failed:', error);
          // Clear invalid token
          localStorage.removeItem('token');
          setUser(null);
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
          path="/article/:id" 
          element={user ? <ArticlePage /> : <Navigate to="/login" />} 
        />

        {/* Fallback Redirect */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;