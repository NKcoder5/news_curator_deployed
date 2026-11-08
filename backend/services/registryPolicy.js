// backend/services/registryPolicy.js
//
// Which claims the public registry shows.
//
// Every claim a signed-in reader checked used to become a public page, whatever the check found. Signing
// up needs no verified address, so anyone could type "<a private person> was arrested for fraud", and the
// registry published that sentence under Pure Press's name, with a page of its own, as "Unproven". The
// re-check scheduler then spent model calls on it three more times. A fact-checker publishes what it
// found, not what it was asked.
//
// So a claim is public only when the check settled it (a call other than CANNOT VERIFY) and the verdict
// rests on at least one item of evidence a reader can open. The evaluation suites' records stay hidden as
// before. Records written before the evidence count existed have none stored; for them the settled call
// alone decides, so the registry does not empty on deploy. A claim that is not public is still kept,
// still re-checked, and becomes public the moment a check settles it.
//
// The rule is written twice, as a database filter and as a function, and test/registryPolicy.test.js
// checks that the two agree.

const SETTLED_CALLS = ['REAL', 'FAKE', 'PARTLY FALSE', 'MISLEADING'];

/**
 * The rule as a database filter. A new object every call: Mongoose casts a query's filter in place, so
 * one shared object could be changed by one query under the next.
 */
const publicFilter = () => ({
  origin: { $ne: 'eval' },
  'current.call': { $in: [...SETTLED_CALLS] },
  // null matches a record with no count at all (written before it existed).
  $or: [{ 'current.evidenceCount': { $gt: 0 } }, { 'current.evidenceCount': null }]
});

/**
 * @param {{origin?: string, call?: string|null, evidenceCount?: number|null}} claim
 * @returns {boolean} whether the registry shows this claim
 */
const isPublicClaim = ({ origin, call, evidenceCount } = {}) => origin !== 'eval'
  && SETTLED_CALLS.includes(call)
  && (evidenceCount === undefined || evidenceCount === null || evidenceCount > 0);

module.exports = { SETTLED_CALLS, publicFilter, isPublicClaim };
