import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import '../styles/Navbar.css';

const logoImg = '/logo.png';

const Navbar = ({ user, setUser }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeLink, setActiveLink] = useState(null);

  useEffect(() => {
    const path = location.pathname;
    if (path === '/dashboard') setActiveLink('dashboard');
    else if (path === '/prompt-quiz') setActiveLink('prompt-quiz');
    else if (path === '/home') setActiveLink('home');
    else if (path.includes('/home')) setActiveLink('categories');
    else setActiveLink(null);
  }, [location]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    setUser(null);
    navigate('/login');
  };

  const handleCategoryClick = () => {
    navigate('/home?category=general');
    setActiveLink('categories');
  };

  const handleLinkClick = (link) => {
    setActiveLink(link);
  };

  return (
    <nav className="navbar">
      <Link to="/" className="logo" onClick={() => handleLinkClick(null)}>
        <img src={logoImg} alt="PurePress Logo" />
        <span className="logo-text">Pure Press</span>
        <span className="logo-tagline">Daily Intelligence</span>
      </Link>
      
      <div className="nav-links">
        {user ? (
          <>
            <Link
              to="/home?category=general"
              className={`nav-link ${activeLink === 'categories' ? 'active' : ''}`}
              onClick={handleCategoryClick}
            >
              <i className="fas fa-newspaper"></i> Categories
            </Link>
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