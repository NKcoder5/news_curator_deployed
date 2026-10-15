import { render, screen, fireEvent, within } from '@testing-library/react';
import VerdictHeader from './VerdictHeader';
import EvidenceBoard from './EvidenceBoard';

// The shape of a real check (live capture, 12 Oct): a figure contradicted by
// four outlets and by this week's coverage, nothing from the fact-checkers.
const report = {
  call: 'FAKE',
  oneLine: '4 independent outlets report otherwise: “85 Medals”.',
  advice: 'Independent reporting contradicts this. Do not share it.',
  analyzedAt: '2026-10-12T10:12:08Z',
  decision: { rule: 'contradicted-by-multiple-independent-sources', grounds: [] },
  trackRecord: { rule: 'contradicted-by-multiple-independent-sources', n: 22, right: 22, wrong: 0, missed: 0, rate: 1, low: 0.851, high: 1, abstains: false },
  understanding: { claims: [{ claim: 'India won 90 medals at the Asian Games 2026.', checkable: true }] },
  memory: { claims: [{ claimId: 'abc123', claim: 'India won 90 medals at the Asian Games 2026.', timesSeen: 1, variants: [] }] },
  factors: [{ id: 'verification', detail: { status: 'contradicted', claims: [{
    claim: 'India won 90 medals at the Asian Games 2026.',
    supportingEvidence: [],
    contradictingEvidence: [{ source: 'News On AIR', title: 'India finishes 4th with 85 Medals', url: 'https://example.test/a', reported: '85 Medals' }]
  }] } }],
  evidence: { perClaim: [{ claim: 'India won 90 medals at the Asian Games 2026.', independentSupport: 0, independentContradiction: 4 }] },
  factChecks: { status: 'none', explanation: '8 published reviews were found, but none examined this exact claim.', matches: [] },
  currentCoverage: { status: 'presupposed-false', counted: true, subject: 'the Asian Games', explanation: 'This week’s coverage only makes sense if the claim is false.', presupposingFalse: [], reporting: [] },
  premiseCheck: { status: 'consistent', explanation: 'Nothing contradicted.', contradictions: [], confirmations: [] }
};

afterEach(() => {
  delete navigator.clipboard;
});

test('the verdict leads with the claim that was checked, then the answer and why', () => {
  render(<VerdictHeader report={report} full />);
  const card = screen.getByRole('region', { name: 'Verdict' });
  expect(within(card).getByText('“India won 90 medals at the Asian Games 2026.”')).toBeInTheDocument();
  expect(within(card).getByText('FAKE')).toBeInTheDocument();
  expect(within(card).getByText(/do not share it/i)).toBeInTheDocument();
  expect(within(card).getByText(/22 of 22/)).toBeInTheDocument();
});

// The link to share is the claim's permanent public page, not this one.
test('copy link copies the claim’s public page', async () => {
  const writeText = jest.fn().mockResolvedValue();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  render(<VerdictHeader report={report} full />);
  fireEvent.click(screen.getByRole('button', { name: /copy link/i }));
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/claims/abc123`);
  expect(await screen.findByRole('button', { name: /copied/i })).toBeInTheDocument();
});

test('without a stored claim, copying gives the result as text', () => {
  const writeText = jest.fn().mockResolvedValue();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  render(<VerdictHeader report={{ ...report, memory: null }} full />);
  fireEvent.click(screen.getByRole('button', { name: /copy result/i }));
  expect(writeText.mock.calls[0][0]).toMatch(/^FAKE: 4 independent outlets report otherwise/);
  expect(writeText.mock.calls[0][0]).toMatch(/Claim: “India won 90 medals/);
});

test('the evidence the verdict rests on comes first; channels that found nothing are listed after', () => {
  render(<EvidenceBoard report={report} />);
  const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent.trim());
  expect(headings[0]).toBe('News reporting');
  expect(headings.indexOf('This week’s news on the Asian Games')).toBeLessThan(headings.indexOf('Fact-checkers'));
  expect(screen.getByText('Also checked')).toBeInTheDocument();
  expect(screen.getAllByText(/this decided the verdict/i)).toHaveLength(1);
});
