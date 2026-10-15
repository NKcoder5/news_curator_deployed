/**
 * Does this failed session check mean the reader is not signed in?
 *
 * Only the server can say a token is invalid. The app used to clear the
 * session on any failure — a backend restart, a dropped connection, a 500, a
 * moment offline — so a reader with a perfectly good token was silently signed
 * out and dropped on the login page. "We could not check" is not "you are not
 * signed in": without a response there is no verdict, so the session stands
 * and the next request settles it.
 *
 * @param {{response?: {status?: number}}} error - the rejected request
 * @returns {boolean} true only when the server rejected the credentials
 */
export const shouldClearSession = (error) => {
  const status = error?.response?.status;
  return status === 401 || status === 403;
};

/**
 * Where to go once the reader has signed in.
 *
 * A signed-out reader who follows a link to a page behind sign-in — "Check it
 * again" on a public claim page, with the claim handed over as router state —
 * is sent to sign in first. They used to land on the dashboard afterwards,
 * with the claim they meant to check gone. The page they asked for, and the
 * state it was given, now travel through sign-in.
 *
 * Only paths inside this app are honoured, never a full or protocol-relative
 * address, so the hand-over cannot be used to send someone elsewhere.
 *
 * @param {{from?: {pathname?: string, search?: string, state?: any}}} [locationState]
 * @returns {{to: string, state: any}}
 */
export const afterSignIn = (locationState) => {
  const from = locationState?.from;
  const path = typeof from?.pathname === 'string' ? from.pathname : '';
  if (!path.startsWith('/') || path.startsWith('//') || path === '/login' || path === '/signup') {
    return { to: '/check', state: null };
  }
  const search = typeof from.search === 'string' && from.search.startsWith('?') ? from.search : '';
  return { to: path + search, state: from.state ?? null };
};
