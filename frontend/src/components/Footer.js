import { Link } from 'react-router-dom';
import BrandMark from './BrandMark';

const Footer = () => (
  <footer className="site-footer">
    <div className="site-footer__inner">
      <div className="site-footer__about">
        <BrandMark size={24} />
        <p>
          Checks news and forwarded messages against independent outlets, fact-checkers and reference
          facts — and shows the evidence behind every verdict.
        </p>
      </div>
      <nav className="site-footer__links" aria-label="Footer">
        <Link to="/check">Check anything</Link>
        <Link to="/claims">Claims database</Link>
        <Link to="/home?category=general">News</Link>
        <Link to="/compare">Compare coverage</Link>
        <Link to="/dashboard">Dashboard</Link>
      </nav>
    </div>
    <p className="site-footer__legal">
      © {new Date().getFullYear()} Pure Press. A verdict is only as good as the evidence it shows — open the sources.
    </p>
  </footer>
);

export default Footer;
