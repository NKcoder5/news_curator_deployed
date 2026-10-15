import { Component } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button, EmptyState } from './ui';

/**
 * Keeps one page's failure from blanking the whole application.
 *
 * Without it a single render error — a field the backend stopped sending, a
 * page chunk that failed to download after a deploy — unmounted everything,
 * header included, and left a white screen with no way back. Now the header
 * stays, the failure is said in words, and navigating elsewhere (a new
 * `resetKey`) clears it.
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Page failed to render:', error, info?.componentStack);
    }
  }

  componentDidUpdate(previous) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    // A chunk that failed to load is cured by a reload; anything else may be too.
    return (
      <div className="page page--narrow">
        <EmptyState
          icon={TriangleAlert}
          title="This page could not be shown"
          description="Something went wrong while drawing it. The rest of Pure Press still works: try again, or reload to fetch the latest version."
          action={(
            <>
              <Button onClick={() => this.setState({ error: null })}>Try again</Button>
              <Button variant="secondary" onClick={() => window.location.reload()}>Reload the page</Button>
            </>
          )}
        />
      </div>
    );
  }
}

export default ErrorBoundary;
