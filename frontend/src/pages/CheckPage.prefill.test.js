import { render, screen } from '@testing-library/react';
import CheckPage from './CheckPage';

jest.mock('../services/api');
// A claim opened from the claims registry ("Check it again") reaches the check
// page as router state. CheckPage.test.js pins the state to null; this pins it
// to what the registry sends. The router is stubbed for the reason given there.
let mockState = { text: 'India won 84 medals at the Asian Games 2026' };
jest.mock('react-router-dom', () => ({ useLocation: () => ({ state: mockState }) }));

test('a claim handed over by the registry is already in the box, ready to check', () => {
  mockState = { text: 'India won 84 medals at the Asian Games 2026' };
  render(<CheckPage />);
  expect(screen.getByPlaceholderText(/Paste the message or post here/i)).toHaveValue('India won 84 medals at the Asian Games 2026');
  expect(screen.getByRole('button', { name: /check it/i })).toBeEnabled();
});

test('arriving without a claim leaves the box empty', () => {
  mockState = null;
  render(<CheckPage />);
  expect(screen.getByPlaceholderText(/Paste the message or post here/i)).toHaveValue('');
});
