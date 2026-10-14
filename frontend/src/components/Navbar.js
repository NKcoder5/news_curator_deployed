import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Newspaper, Columns2, ShieldCheck, LineChart, LogOut, LogIn, UserPlus
} from 'lucide-react';
import '../styles/Navbar.css';

const logoImg = '/logo.png';

const Navbar = ({ user, setUser }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeLink, setActiveLink] = useState(null);

  useEffect(() => {
    const path = location.pathname;
    if (path === '/dashboard') setActiveLink('dashboard');
    else if (path === '/check') setActiveLink('check');
    else if (path === '/compare') setActiveLink('compare');
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
              <Newspaper size={15} /> Categories
            </Link>
            <Link
              to="/check"
              className={`nav-link ${activeLink === 'check' ? 'active' : ''}`}
              onClick={() => handleLinkClick('check')}
            >
              <ShieldCheck size={15} /> Check anything
            </Link>
            <Link
              to="/compare"
              className={`nav-link ${activeLink === 'compare' ? 'active' : ''}`}
              onClick={() => handleLinkClick('compare')}
            >
              <Columns2 size={15} /> Compare
            </Link>
            <Link
              to="/dashboard"
              className={`nav-link ${activeLink === 'dashboard' ? 'active' : ''}`}
              onClick={() => handleLinkClick('dashboard')}
            >
              <LineChart size={15} /> Dashboard
            </Link>
            <button onClick={handleLogout} className="logout-btn">
              <LogOut size={15} /> Logout
            </button>
          </>
        ) : (
          <>
            <Link
              to="/login"
              className={`nav-link ${activeLink === 'login' ? 'active' : ''}`}
              onClick={() => handleLinkClick('login')}
            >
              <LogIn size={15} /> Login
            </Link>
            <Link
              to="/signup"
              className={`nav-link ${activeLink === 'signup' ? 'active' : ''}`}
              onClick={() => handleLinkClick('signup')}
            >
              <UserPlus size={15} /> Signup
            </Link>
          </>
        )}
      </div>
    </nav>
  );
};

export default Navbar;