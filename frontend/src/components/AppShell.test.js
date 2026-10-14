import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';
import NotFoundPage from '../pages/NotFoundPage';
import useDocumentTitle from '../hooks/useDocumentTitle';

// react-router v7's export map does not resolve under the Jest config CRA
// ships; the 404 page needs only Link from it.
jest.mock('react-router-dom', () => ({
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>
}));

const Broken = () => { throw new Error('a field the backend stopped sending'); };

describe('ErrorBoundary', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  test('a page that fails to render is replaced by a message, not a blank screen', () => {
    render(<ErrorBoundary resetKey="/check"><Broken /></ErrorBoundary>);
    expect(screen.getByRole('heading', { name: /could not be shown/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  test('moving to another page clears the failure', () => {
    const Harness = () => {
      const [path, setPath] = useState('/check');
      return (
        <>
          <button type="button" onClick={() => setPath('/home')}>go home</button>
          <ErrorBoundary resetKey={path}>{path === '/check' ? <Broken /> : <p>Home page</p>}</ErrorBoundary>
        </>
      );
    };
    render(<Harness />);
    expect(screen.getByRole('heading', { name: /could not be shown/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'go home' }));
    expect(screen.getByText('Home page')).toBeInTheDocument();
  });
});

describe('Not found and page titles', () => {
  test('an unknown address says so and offers a way on', () => {
    render(<NotFoundPage signedIn />);
    expect(screen.getByRole('heading', { level: 1, name: /does not exist/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /check a claim/i })).toHaveAttribute('href', '/check');
    expect(document.title).toBe('Page not found · Pure Press');
  });

  test('a page without a name is titled with the site alone', () => {
    const Page = () => { useDocumentTitle(); return null; };
    render(<Page />);
    expect(document.title).toMatch(/^Pure Press/);
  });
});
