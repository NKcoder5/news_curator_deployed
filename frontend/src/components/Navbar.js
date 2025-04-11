import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import '../styles/Navbar.css';

const logoImg = '/logo.png';

const categories = [
  { value: 'general', label: '🌐 General' },
  { value: 'technology', label: '💻 Technology' },
  { value: 'business', label: '💼 Business' },
  { value: 'sports', label: '⚽ Sports' },
  { value: 'science', label: '🔬 Science' },
  { value: 'health', label: '🏥 Health' },
  { value: 'entertainment', label: '🎬 Entertainment' }
];

const Navbar = ({ user, setUser }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeLink, setActiveLink] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('general');
  const dropdownRef = useRef(null);

  useEffect(() => {
    const path = location.pathname;
    if (path === '/dashboard') setActiveLink('dashboard');
    else if (path === '/prompt-quiz') setActiveLink('prompt-quiz');
    else if (path === '/home') setActiveLink('home');
    else setActiveLink(null);
  }, [location]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    setUser(null);
    navigate('/login');
  };

  const handleCategoryChange = (category) => {
    setSelectedCategory(category);
    navigate(`/home?category=${category}`);
  };

  const handleLinkClick = (link) => {
    setActiveLink(link);
  };

  return (
    <nav className="navbar">
      <Link to="/" className="logo" onClick={() => handleLinkClick(null)}>
        <img src={logoImg} alt="NewsAI Logo" />
        NewsAI
      </Link>
      <div className="nav-links">
        {user ? (
          <>
            <div className="dropdown-container" ref={dropdownRef}>
              <button className="nav-link dropdown-toggle">
                <i className="fas fa-list"></i> Categories
              </button>
              <div className="dropdown-menu">
                {categories.map(category => (
                  <button
                    key={category.value}
                    className={`dropdown-item ${selectedCategory === category.value ? 'active' : ''}`}
                    onClick={() => handleCategoryChange(category.value)}
                  >
                    {category.label}
                  </button>
                ))}
              </div>
            </div>
            <Link
              to="/prompt-quiz"
              className={`nav-link ${activeLink === 'prompt-quiz' ? 'active' : ''}`}
              onClick={() => handleLinkClick('prompt-quiz')}
            >
              <i className="fas fa-question-circle"></i> Quiz
            </Link>
            <Link
              to="/dashboard"
              className={`nav-link ${activeLink === 'dashboard' ? 'active' : ''}`}
              onClick={() => handleLinkClick('dashboard')}
            >
              <i className="fas fa-chart-line"></i> Dashboard
            </Link>
            <button onClick={handleLogout} className="logout-btn">
              <i className="fas fa-sign-out-alt"></i> Logout
            </button>
          </>
        ) : (
          <>
            <Link
              to="/login"
              className={`nav-link ${activeLink === 'login' ? 'active' : ''}`}
              onClick={() => handleLinkClick('login')}
            >
              <i className="fas fa-sign-in-alt"></i> Login
            </Link>
            <Link
              to="/signup"
              className={`nav-link ${activeLink === 'signup' ? 'active' : ''}`}
              onClick={() => handleLinkClick('signup')}
            >
              <i className="fas fa-user-plus"></i> Signup
            </Link>
          </>
        )}
      </div>
    </nav>
  );
};

export default Navbar;