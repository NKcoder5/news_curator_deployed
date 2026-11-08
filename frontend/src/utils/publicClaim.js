/**
 * The id of the claim's public page, when this check has one.
 *
 * The registry publishes a claim only when a check settled it on evidence (backend
 * services/registryPolicy.js); a check of anything else still has a record, but no public page, and a
 * link to one would open "No record of that claim". The server says which in `memory.claims[].public`.
 * A check stored before that flag existed has no value, and its page exists as it always did.
 *
 * @param {Object} [memory] - report.memory from a check
 * @returns {string|null}
 */
export const publicClaimId = (memory) => {
  const claims = memory?.claims || [];
  if (claims.length !== 1 || !claims[0]?.claimId) return null;
  return claims[0].public === false ? null : claims[0].claimId;
};
