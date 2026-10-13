import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import api from '../services/api';
import { afterSignIn } from '../services/session';
import BrandMark from '../components/BrandMark';
import PasswordInput from '../components/PasswordInput';
import { Alert, Button, Field } from '../components/ui';
import useDocumentTitle from '../hooks/useDocumentTitle';
import '../styles/AuthPage.css';

const MIN_PASSWORD = 8;

/** Create an account. The same plain form as sign-in, with the checks said beside each field. */
const SignupPage = ({ setUser }) => {
  useDocumentTitle('Create an account');
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Field errors appear once the reader has tried to submit, or as soon as a
  // field they have filled in is wrong — not while they are still typing it.
  const emailError = submitted && !email ? 'Enter your email address.' : '';
  const passwordError = (submitted || password) && password.length < MIN_PASSWORD
    ? `Use at least ${MIN_PASSWORD} characters.` : '';
  const confirmError = (submitted || confirmPassword) && confirmPassword !== password
    ? 'The two passwords do not match.' : '';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    setError('');
    if (!email || password.length < MIN_PASSWORD || password !== confirmPassword) return;

    setIsLoading(true);
    try {
      const res = await api.post('/auth/signup', { email, password });
      localStorage.setItem('token', res.data.token);
      setUser({ token: res.data.token });
      const { to, state } = afterSignIn(location.state);
      navigate(to, { replace: true, state });
    } catch (err) {
      setError(err.response?.data?.error || 'The account could not be created. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__brand"><BrandMark size={36} showName={false} /></div>
        <h1 className="auth-card__title">Create your account</h1>
        <p className="auth-card__lead">Free, and no payment details. Your checks and reading history stay yours.</p>

        {error && <Alert tone="danger">{error}</Alert>}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <Field label="Email address" error={emailError}>
            <input
              className="ui-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Password" hint={passwordError ? undefined : `At least ${MIN_PASSWORD} characters.`} error={passwordError}>
            <PasswordInput
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <Field label="Confirm password" error={confirmError}>
            <PasswordInput
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </Field>
          <Button type="submit" size="lg" block loading={isLoading} icon={UserPlus}>
            {isLoading ? 'Creating your account…' : 'Create account'}
          </Button>
        </form>

        <p className="auth-card__switch">
          Already have an account? <Link to="/login" state={location.state}>Sign in</Link>
        </p>
      </div>
    </div>
  );
};

export default SignupPage;
