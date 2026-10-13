import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import api from '../services/api';
import { afterSignIn } from '../services/session';
import BrandMark from '../components/BrandMark';
import PasswordInput from '../components/PasswordInput';
import { Alert, Button, Field } from '../components/ui';
import useDocumentTitle from '../hooks/useDocumentTitle';
import '../styles/AuthPage.css';

/**
 * Sign in. It used to be a newspaper "subscriber login" with an unfolding
 * animation, floating mock front pages and a "VERIFIED" rubber stamp; it is a
 * form now, and it goes through the shared API client like every other page
 * (it had its own base address, which broke when REACT_APP_API_URL was set
 * the way services/api.js expects).
 */
const LoginPage = ({ setUser }) => {
  useDocumentTitle('Sign in');
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email || !password) {
      setError('Enter your email address and password.');
      return;
    }
    setIsLoading(true);
    try {
      const res = await api.post('/auth/login', { email, password });
      localStorage.setItem('token', res.data.token);
      setUser({ token: res.data.token });
      // Back to the page the reader was sent here from, with what it carried.
      const { to, state } = afterSignIn(location.state);
      navigate(to, { replace: true, state });
    } catch (err) {
      setError(err.response?.data?.error || 'Sign-in failed. Check your email address and password.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__brand"><BrandMark size={36} showName={false} /></div>
        <h1 className="auth-card__title">Sign in to Pure Press</h1>
        <p className="auth-card__lead">Check messages, keep a record of what you have read, and see what the checks found.</p>

        {error && <Alert tone="danger">{error}</Alert>}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <Field label="Email address">
            <input
              className="ui-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Password">
            <PasswordInput
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <Button type="submit" size="lg" block loading={isLoading} icon={LogIn}>
            {isLoading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="auth-card__switch">
          New to Pure Press? <Link to="/signup" state={location.state}>Create an account</Link>
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
