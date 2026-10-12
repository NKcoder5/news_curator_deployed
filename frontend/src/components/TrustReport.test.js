import { render, screen, fireEvent } from '@testing-library/react';
import TrustReport from './TrustReport';
import api from '../services/api';

// The claim record fetches a claim's history on request.
jest.mock('../services/api');

// A fabricated story, scored the way the pipeline actually scores one: the
// writing checks accuse it, nothing corroborates it, and the three bookkeeping
// rows (the starting point, the overlap discount, the calibration correction)
// carry negative weights.
const fabricated = {
  call: 'CANNOT VERIFY',
  oneLine: 'No other outlet is reporting this, so nothing supports it either way.',
  verdict: 'Not confirmed',
  verdictLevel: 'unverified',
  probabilityPercent: 83,
  decision: { grounds: ['No independent outlet was found reporting these claims.'], rule: 'R8', confidence: 0.5 },
  factors: [],
  quality: null,
  evidence: {},
  evidenceLedger: [
    { step: 'prior', label: 'Before reading the article', decibans: -1.2, detail: 'No reliability record.' },
    { step: 'factor', label: 'clickbait', observation: 3, decibans: 9.1 },
    { step: 'adjustment', label: 'style-correlation-damping', decibans: -8.4, detail: 'The writing checks overlap.' },
    { step: 'adjustment', label: 'calibration', decibans: 1.1 },
    { step: 'corroboration', label: 'Independent corroboration', decibans: 1.4 }
  ]
};

const openWorking = () => {
  render(<TrustReport report={fabricated} />);
  fireEvent.click(screen.getByRole('button', { name: /how do you know/i }));
  fireEvent.click(screen.getByRole('button', { name: /show the full working/i }));
};

// The heart of the model is that nothing the author controls can speak in the
// article's favour. A bookkeeping row with a negative weight is not the
// article's writing vouching for it, and must never be worded as if it were.
test('bookkeeping rows are never worded as evidence that the story is genuine', () => {
  openWorking();
  expect(screen.getByText(/we estimate a/i)).toBeInTheDocument();
  expect(screen.queryByText(/suggests it is genuine/i)).not.toBeInTheDocument();
});

test('the starting point is described as a starting point', () => {
  openWorking();
  expect(screen.getByText(/starts out trusted/i)).toBeInTheDocument();
});

test('an overlap discount says it counts the writing checks for less', () => {
  openWorking();
  expect(screen.getByText(/counts the writing checks for less/i)).toBeInTheDocument();
});

// Real evidence keeps the evidence vocabulary.
test('a writing check that accuses still says so', () => {
  openWorking();
  expect(screen.getByText(/strongly suggests it is made up/i)).toBeInTheDocument();
});

// A viral rumour the desks have ruled on. The Check page lays the evidence out
// at once, and marks the channel the verdict rule acted on.
const debunked = {
  call: 'FAKE',
  oneLine: 'Rated false by The Quint and Newschecker after checking this exact claim.',
  verdict: 'False',
  verdictLevel: 'false',
  decision: { grounds: [], rule: 'rated-false-by-fact-checkers', confidence: 0.93 },
  factors: [{ id: 'verification', detail: { status: 'unverified', claims: [] } }],
  quality: null,
  evidence: { perClaim: [] },
  factChecks: {
    status: 'debunked',
    explanation: 'Rated false by 2 fact-checking desks: The Quint, Newschecker.',
    matches: [
      { publisher: 'The Quint', rating: 'False', finding: 'false', reviewedAt: '2026-10-05', claimReviewed: 'Every Saturday declared a bank holiday.', url: 'https://example.test/q', via: 'claimreview' },
      { publisher: 'Newschecker', rating: null, finding: 'false', reviewedAt: '2026-10-05', claimReviewed: 'Viral gazette is fake', url: 'https://example.test/n', via: 'news-search' }
    ]
  },
  currentCoverage: { status: 'silent', subject: 'bank holidays', explanation: 'Neither mentions nor rules out the claim.', presupposingFalse: [], reporting: [] },
  premiseCheck: { status: 'no-entities', explanation: 'Nothing to look up.', contradictions: [] }
};

test('the Check page shows the evidence board and what decided the verdict', () => {
  render(<TrustReport report={debunked} evidenceFirst />);
  expect(screen.getByText(/decided by/i)).toBeInTheDocument();
  // No hand-set confidence: without a measured record the page says so.
  expect(screen.queryByText('93%')).not.toBeInTheDocument();
  expect(screen.getByText(/none yet/i)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Fact-checkers' })).toBeInTheDocument();
  expect(screen.getAllByText(/this decided the verdict/i)).toHaveLength(1);
  expect(screen.getAllByRole('link', { name: /read the fact-check/i })).toHaveLength(2);
});

test('the article page keeps the evidence behind its button', () => {
  render(<TrustReport report={debunked} />);
  expect(screen.queryByText(/this decided the verdict/i)).not.toBeInTheDocument();
});

test('the claim record shows a claim checked before and a variant with its difference', () => {
  const report = {
    ...debunked,
    call: 'FAKE',
    memory: {
      assessmentId: 'a1',
      changeReason: null,
      claims: [{
        claimId: 'c1', claim: 'India won 84 medals at the 2026 Asian Games.', timesSeen: 3,
        firstSeenAt: '2026-10-12T07:32:00Z',
        previous: { call: 'FAKE', oneLine: '3 outlets report otherwise', at: '2026-10-12T07:40:00Z' },
        variants: [{ claimId: 'c2', claim: 'India won 85 medals at the Asian Games 2026.', differences: ['figure: 84 medal vs 85 medal'], call: 'REAL', at: '2026-10-12T07:45:00Z' }]
      }]
    }
  };
  render(<TrustReport report={report} evidenceFirst />);
  expect(screen.getByRole('region', { name: 'Claim record' })).toBeInTheDocument();
  expect(screen.getByText(/3 times/)).toBeInTheDocument();
  expect(screen.getByText(/Variant checked before/i)).toBeInTheDocument();
  expect(screen.getByText(/figure: 84 medal vs 85 medal/)).toBeInTheDocument();
});

test('the verdict shows the measured track record of its rule, not a hand-set confidence', () => {
  const report = {
    ...debunked,
    trackRecord: { rule: 'rated-false-by-fact-checkers', n: 13, right: 13, wrong: 0, missed: 0, rate: 1, low: 0.772, high: 1, abstains: false }
  };
  render(<TrustReport report={report} evidenceFirst />);
  expect(screen.getByText(/13 of 13/)).toBeInTheDocument();
  expect(screen.getByText(/95% range 77%–100%/)).toBeInTheDocument();
});

test('what decided it: the evidence the verdict depends on, and what would change it', () => {
  const report = {
    ...debunked,
    call: 'FAKE',
    explanation: {
      verdict: { call: 'FAKE', rule: 'contradicted-by-multiple-independent-sources' },
      restsOn: 1,
      decisive: [
        { channel: 'news-against', label: 'the outlets reporting otherwise', decisive: true, without: { call: 'CANNOT VERIFY' } },
        { channel: 'reference', label: 'the encyclopedia entry', decisive: false, without: { call: 'FAKE' } }
      ],
      wouldChange: [
        { change: '3 more independent outlets confirming it', added: { stance: 'for', outlets: 3 }, result: { call: 'CANNOT VERIFY' } },
        { change: '4 more independent outlets confirming it', added: { stance: 'for', outlets: 4 }, result: { call: 'REAL' } }
      ]
    }
  };
  render(<TrustReport report={report} evidenceFirst />);
  const region = screen.getByRole('region', { name: 'What decided it' });
  expect(region).toHaveTextContent(/Without the outlets reporting otherwise, the answer would be CANNOT VERIFY/);
  expect(region).toHaveTextContent(/Without the encyclopedia entry, it would still be FAKE/);
  expect(region).toHaveTextContent(/4 more independent outlets confirming it → REAL/);
});

test('an unsettled claim says when it will be looked at again, and its history opens on request', async () => {
  api.get.mockResolvedValue({
    data: {
      claimId: 'c9', claim: 'Velmurugan Sweets opened a second branch in Erode.',
      history: [
        { assessmentId: 'a1', at: '2026-10-12T04:00:00Z', trigger: 'user', call: 'CANNOT VERIFY', evidence: { for: 0, against: 0, rulings: 0 }, changeReason: null },
        { assessmentId: 'a2', at: '2026-10-12T10:00:00Z', trigger: 'recheck', call: 'REAL', evidence: { for: 2, against: 0, rulings: 0 },
          changeReason: 'Verdict changed from CANNOT VERIFY to REAL on an automatic re-check: 2 new sources confirm it (The Hindu and NDTV).' }
      ]
    }
  });
  const report = {
    ...debunked,
    call: 'CANNOT VERIFY',
    memory: {
      assessmentId: 'a3', changeReason: null,
      claims: [{ claimId: 'c9', claim: 'Velmurugan Sweets opened a second branch in Erode.', timesSeen: 2,
        firstSeenAt: '2026-10-12T04:00:00Z', previous: null, recheckDue: '2026-10-13T10:00:00Z', variants: [] }]
    }
  };
  render(<TrustReport report={report} evidenceFirst />);
  expect(screen.getByText(/checked again automatically/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /show every verdict/i }));
  expect(api.get).toHaveBeenCalledWith('/ai/claims/c9');
  const list = await screen.findByRole('list', { name: 'Verdict history' });
  expect(list).toHaveTextContent(/Re-checked automatically → REAL/);
  expect(list).toHaveTextContent(/2 new sources confirm it \(The Hindu and NDTV\)/);
});
