import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import ArticlePage from './pages/ArticlePage';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import LandingPage from './pages/LandingPage';
import Navbar from './components/Navbar';
import './styles/global.css';

const App = () => {
  const [user, setUser] = useState(
    localStorage.getItem('token') ? { token: localStorage.getItem('token') } : null
  );

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