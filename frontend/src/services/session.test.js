import { shouldClearSession } from './session';

// Twice during testing the app dumped a signed-in reader on the login page
// while their token was valid, because the session check had failed for a
// reason that said nothing about the token: the backend was restarting.
test('a request that never reached the server does not end the session', () => {
  expect(shouldClearSession(Object.assign(new Error('Network Error'), { response: undefined }))).toBe(false);
});

test('a server error does not end the session', () => {
  expect(shouldClearSession({ response: { status: 500 } })).toBe(false);
  expect(shouldClearSession({ response: { status: 502 } })).toBe(false);
});

test('a rejected credential does end the session', () => {
  expect(shouldClearSession({ response: { status: 401 } })).toBe(true);
  expect(shouldClearSession({ response: { status: 403 } })).toBe(true);
});

test('a malformed error is not treated as a rejection', () => {
  expect(shouldClearSession(undefined)).toBe(false);
  expect(shouldClearSession({})).toBe(false);
});
