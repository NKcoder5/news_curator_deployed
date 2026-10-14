import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import ErrorBoundary from './components/ErrorBoundary';
import { LoadingRegion, Skeleton, SkeletonText } from './components/ui';
import api from './services/api';
import { afterSignIn, shouldClearSession } from './services/session';
import './styles/tokens.css';
import './styles/global.css';
import './styles/newsprint.css';

// Each page is its own download. A reader who comes to check one message
// should not first fetch the dashboard, the comparison page and the article
// reader; the landing page in particular has to arrive fast.
const LandingPage = lazy(() => import('./pages/LandingPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const SignupPage = lazy(() => import('./pages/SignupPage'));
const HomePage = lazy(() => import('./pages/HomePage'));
const ArticlePage = lazy(() => import('./pages/ArticlePage'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ComparePage = lazy(() => import('./pages/ComparePage'));
const CheckPage = lazy(() => import('./pages/CheckPage'));
const ClaimsPage = lazy(() => import('./pages/ClaimsPage'));
const ClaimDetailPage = lazy(() => import('./pages/ClaimDetailPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

/** The shape of a page, shown while its code or the session is loading. */
const PageFallback = () => (
  <div className="page">
    <LoadingRegion label="Loading the page" className="page-fallback">
      <div className="page-fallback__head">
        <Skeleton width="120px" height="14px" />
        <Skeleton width="70%" height="34px" />
        <SkeletonText lines={2} />
      </div>
      <div className="page-fallback__grid">
        <Skeleton height="280px" radius="12px" />
        <Skeleton height="280px" radius="12px" />
      </div>
    </LoadingRegion>
  </div>
);

const AppRoutes = ({ user, setUser, checkingSession }) => {
  const location = useLocation();
  const { pathname, search } = location;
  // Pages behind sign-in wait for the session check rather than bouncing a
  // signed-in reader to the login page while it runs. A reader who is sent to
  // sign in carries the page they asked for, and its state, with them
  // (services/session.js afterSignIn).
  const signedIn = (element) => (checkingSession ? <PageFallback />
    : user ? element
    : <Navigate to="/login" replace state={{ from: { pathname, search, state: location.state } }} />);
  const signedOut = (element) => {
    if (!user) return element;
    const { to, state } = afterSignIn(location.state);
    return <Navigate to={to} state={state} replace />;
  };

  return (
    <ErrorBoundary resetKey={pathname}>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<LandingPage signedIn={Boolean(user)} />} />
          <Route path="/login" element={signedOut(<LoginPage setUser={setUser} />)} />
          <Route path="/signup" element={signedOut(<SignupPage setUser={setUser} />)} />

          {/* The claims registry is public: anyone can look a claim up. */}
          <Route path="/claims" element={<ClaimsPage />} />
          <Route path="/claims/:id" element={<ClaimDetailPage />} />

          <Route path="/check" element={signedIn(<CheckPage />)} />
          <Route path="/home" element={signedIn(<HomePage />)} />
          <Route path="/article" element={signedIn(<ArticlePage />)} />
          <Route path="/compare" element={signedIn(<ComparePage />)} />
          <Route path="/dashboard" element={signedIn(<Dashboard />)} />

          <Route path="*" element={<NotFoundPage signedIn={Boolean(user)} />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
};

const App = () => {
  const [user, setUser] = useState(() => {
    const token = localStorage.getItem('token');
    return token ? { token } : null;
  });
  const [checkingSession, setCheckingSession] = useState(() => Boolean(localStorage.getItem('token')));

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    api.get('/auth/verify')
      .then((response) => {
        setUser({ token, userId: response.data.userId, interests: response.data.interests || [] });
      })
      .catch((error) => {
        // See services/session.js: a check that could not run is not a
        // rejected credential, and clearing the token on one signed readers
        // out mid-session every time the backend restarted.
        if (shouldClearSession(error)) {
          localStorage.removeItem('token');
          setUser(null);
          return;
        }
        console.warn('Could not verify the session just now; keeping it.', error.message);
      })
      .finally(() => setCheckingSession(false));
  }, []);

  return (
    <BrowserRouter>
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="app">
        <Navbar user={user} setUser={setUser} />
        <main id="main" className="app-main" tabIndex={-1}>
          <AppRoutes user={user} setUser={setUser} checkingSession={checkingSession} />
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  );
};

export default App;
