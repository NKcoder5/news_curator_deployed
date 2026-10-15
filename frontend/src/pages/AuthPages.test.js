import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from './LoginPage';
import SignupPage from './SignupPage';
import api from '../services/api';

jest.mock('../services/api');
// react-router v7's export map does not resolve under the Jest config CRA
// ships; the pages use these three things from it.
const mockNavigate = jest.fn();
let mockState = null;
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: mockState }),
  Link: ({ to, children }) => <a href={to}>{children}</a>
}));

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockState = null;
});

const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

// The registry's "Check it again" sends a signed-out reader through sign-in
// with the claim as router state; it must arrive at /check still carrying it.
test('signing in returns the reader to the page they were sent from, with its state', async () => {
  mockState = { from: { pathname: '/check', search: '', state: { text: 'India won 84 medals at the Asian Games 2026' } } };
  api.post.mockResolvedValue({ data: { token: 't0k3n' } });
  const setUser = jest.fn();
  render(<LoginPage setUser={setUser} />);

  fill('Email address', 'reader@example.test');
  fill('Password', 'a-long-password');
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

  await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
  expect(api.post).toHaveBeenCalledWith('/auth/login', { email: 'reader@example.test', password: 'a-long-password' });
  expect(localStorage.getItem('token')).toBe('t0k3n');
  expect(setUser).toHaveBeenCalledWith({ token: 't0k3n' });
  expect(mockNavigate).toHaveBeenCalledWith('/check', { replace: true, state: { text: 'India won 84 medals at the Asian Games 2026' } });
});

test('a rejected sign-in says why, beside the form', async () => {
  api.post.mockRejectedValue({ response: { status: 401, data: { error: 'Invalid email or password.' } } });
  render(<LoginPage setUser={jest.fn()} />);
  fill('Email address', 'reader@example.test');
  fill('Password', 'wrong-password');
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
  expect(mockNavigate).not.toHaveBeenCalled();
});

test('the password can be shown and hidden', () => {
  render(<LoginPage setUser={jest.fn()} />);
  const field = screen.getByLabelText('Password');
  expect(field).toHaveAttribute('type', 'password');
  fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
  expect(field).toHaveAttribute('type', 'text');
});

test('sign-up says what is wrong beside each field and sends nothing until it is right', () => {
  render(<SignupPage setUser={jest.fn()} />);
  fill('Email address', 'reader@example.test');
  fill('Password', 'short');
  fill('Confirm password', 'different');
  fireEvent.click(screen.getByRole('button', { name: /create account/i }));
  expect(screen.getByText(/use at least 8 characters/i)).toBeInTheDocument();
  expect(screen.getByText(/do not match/i)).toBeInTheDocument();
  expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
  expect(api.post).not.toHaveBeenCalled();
});
