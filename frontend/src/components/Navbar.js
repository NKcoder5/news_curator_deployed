import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Columns2, LayoutDashboard, Library, LogIn, LogOut, Menu, Newspaper, ShieldCheck, X } from 'lucide-react';
import BrandMark from './BrandMark';
import { Button, ThemeToggle } from './ui';
import '../styles/AppShell.css';

/**
 * The places a signed-in reader can go, in order of how much they matter:
 * checking comes first because it is the product. A new section is one line
 * here; `match` decides when its link reads as the current page.
 */
export const NAV_LINKS = [
  { to: '/check', label: 'Check', icon: ShieldCheck, match: (path) => path === '/check' },
  // The claims registry is public, so its link shows signed in or not.
  { to: '/claims', label: 'Claims', icon: Library, match: (path) => path.startsWith('/claims'), isPublic: true },
  { to: '/home?category=general', label: 'News', icon: Newspaper, match: (path) => path === '/home' || path === '/article' },
  { to: '/compare', label: 'Compare', icon: Columns2, match: (path) => path === '/compare' },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, match: (path) => path === '/dashboard' }
];

const Navbar = ({ user, setUser }) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef(null);

  // A route change closes the phone menu; so does Escape, returning focus to
  // the button that opened it.
  useEffect(() => { setMenuOpen(false); }, [pathname]);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    setUser(null);
    navigate('/login');
  };

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link to="/" className="site-header__brand" aria-label="Pure Press home">
          <BrandMark />
        </Link>

        <nav
          id="site-nav"
          className={`site-nav ${menuOpen ? 'is-open' : ''}`}
          aria-label="Main"
        >
          <ul className="site-nav__links">
            {NAV_LINKS.filter((link) => user || link.isPublic).map(({ to, label, icon: Icon, match }) => {
              const current = match(pathname);
              return (
                <li key={to}>
                  <Link
                    to={to}
                    className={`site-nav__link ${current ? 'is-current' : ''}`}
                    aria-current={current ? 'page' : undefined}
                  >
                    <Icon size={16} aria-hidden="true" />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="site-nav__account">
            {user ? (
              <Button variant="ghost" icon={LogOut} onClick={handleLogout}>Sign out</Button>
            ) : (
              <>
                <Button as={Link} to="/login" variant="ghost" icon={LogIn}>Sign in</Button>
                <Button as={Link} to="/signup">Create account</Button>
              </>
            )}
          </div>
        </nav>

        <div className="site-header__tools">
          <ThemeToggle />
          <button
            ref={menuButton}
            type="button"
            className="ui-btn ui-btn--ghost ui-btn--md ui-btn--icon-only site-header__menu"
            aria-expanded={menuOpen}
            aria-controls="site-nav"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </header>
  );
};

export default Navbar;
