import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import '../styles/Navbar.css';
// Reference logo from public folder
const logoImg = '/logo.png'; // NewsAI logo

const Navbar = ({ user, setUser }) => {
  const navigate = useNavigate();
  const [activeLink, setActiveLink] = useState(null); // Track active link

  const handleLogout = () => {
    localStorage.removeItem('token');
    setUser(null);
    navigate('/login');
  };

  const handleSearch = (e) => {
    e.preventDefault();
    const query = e.target.elements.search.value;
    if (query) {
      navigate(`/search?q=${encodeURIComponent(query)}`);
    }
  };

  const handleLinkClick = (link) => {
    setActiveLink(link); // Set clicked link as active
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
            <form className="search-bar" onSubmit={handleSearch}>
              <i className="fas fa-newspaper search-logo"></i>
              <input
                type="text"
                name="search"
                placeholder="Search news..."
                aria-label="Search news"
              />
              <button type="submit">
                <i className="fas fa-search"></i>
              </button>
            </form>
            <Link
              to="/dashboard"
              className={`nav-link ${activeLink === 'dashboard' ? 'active' : ''}`}
              onClick={() => handleLinkClick('dashboard')}
            >
              Dashboard
            </Link>
            <button onClick={handleLogout} className="logout-btn">
              Logout
            </button>
          </>
        ) : (
          <>
            <Link
              to="/login"
              className={`nav-link ${activeLink === 'login' ? 'active' : ''}`}
              onClick={() => handleLinkClick('login')}
            >
              Login
            </Link>
            <Link
              to="/signup"
              className={`nav-link ${activeLink === 'signup' ? 'active' : ''}`}
              onClick={() => handleLinkClick('signup')}
            >
              Signup
            </Link>
            <form className="search-bar" onSubmit={handleSearch}>
              <i className="fas fa-newspaper search-logo"></i>
              <input
                type="text"
                name="search"
                placeholder="Search news..."
                aria-label="Search news"
              />
              <button type="submit">
                <i className="fas fa-search"></i>
              </button>
            </form>
          </>
        )}
      </div>
    </nav>
  );
};

export default Navbar;