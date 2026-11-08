import { publicClaimId } from './publicClaim';

const ID = '6710f0c2a1b2c3d4e5f60718';

test('a check of one claim that was published links its page', () => {
  expect(publicClaimId({ claims: [{ claimId: ID, public: true }] })).toBe(ID);
});

test('a check whose claim was not published links nothing', () => {
  expect(publicClaimId({ claims: [{ claimId: ID, public: false }] })).toBeNull();
});

test('a check stored before the flag existed keeps its link', () => {
  expect(publicClaimId({ claims: [{ claimId: ID }] })).toBe(ID);
});

test('a message of several claims, or no memory at all, links nothing', () => {
  expect(publicClaimId({ claims: [{ claimId: ID, public: true }, { claimId: 'b', public: true }] })).toBeNull();
  expect(publicClaimId(null)).toBeNull();
  expect(publicClaimId({ claims: [] })).toBeNull();
});
