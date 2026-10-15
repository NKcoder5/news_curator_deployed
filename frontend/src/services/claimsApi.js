import api from './api';

/**
 * The public claims registry (backend/routes/claimRoutes.js). Every call is a
 * read, and none needs a signed-in reader, so these pages work for anyone who
 * is sent a link to a claim. The shared client's base URL already ends in /api.
 */

// An empty field is "no filter", not a filter for the empty string.
const given = (params = {}) =>
  Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''));

const read = (url, params) => api.get(url, { params: given(params) }).then((response) => response.data);

/** @param {{q?, call?, sort?, limit?, cursor?}} params */
export const listClaims = (params) => read('/claims', params);
export const getTrending = (limit) => read('/claims/trending', { limit });
export const getChanges = (limit) => read('/claims/changes', { limit });
export const getStats = () => read('/claims/stats');
export const getClaim = (id) => read(`/claims/${encodeURIComponent(id)}`);
