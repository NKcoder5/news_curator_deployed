import { afterSignIn, shouldClearSession } from './session';

// "Check it again" on a public claim page hands the claim to /check, which is
// behind sign-in; the claim must survive the detour through the login page.
test('after sign-in the reader goes where they were going, with what they carried', () => {
  const from = { pathname: '/check', search: '', state: { text: 'India won 84 medals at the Asian Games 2026' } };
  expect(afterSignIn({ from })).toEqual({ to: '/check', state: { text: 'India won 84 medals at the Asian Games 2026' } });
  expect(afterSignIn({ from: { pathname: '/home', search: '?category=sports' } })).toEqual({ to: '/home?category=sports', state: null });
});

test('with nowhere to return to, sign-in leads to the check page', () => {
  expect(afterSignIn(null)).toEqual({ to: '/check', state: null });
  expect(afterSignIn({ from: { pathname: '/login' } })).toEqual({ to: '/check', state: null });
});

test('only paths inside the app are followed', () => {
  expect(afterSignIn({ from: { pathname: 'https://evil.example/' } }).to).toBe('/check');
  expect(afterSignIn({ from: { pathname: '//evil.example/x' } }).to).toBe('/check');
});

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
