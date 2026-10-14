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
