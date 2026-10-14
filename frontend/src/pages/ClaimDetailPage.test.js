import { render, screen, fireEvent, within } from '@testing-library/react';
import ClaimDetailPage from './ClaimDetailPage';
import api from '../services/api';

jest.mock('../services/api');
// See ClaimsPage.test.js for why the router is stood in for. The anchor also
// carries the link's state, so a test can see what the next page is handed.
jest.mock('react-router-dom', () => {
  const React = require('react');
  return {
    useParams: () => ({ id: 'claim1' }),
    Link: ({ to, state, children, ...rest }) =>
      React.createElement('a', { href: to, 'data-state': state ? JSON.stringify(state) : undefined, ...rest }, children)
  };
});

const CLAIM = {
  claimId: 'claim1',
  claim: 'India won 84 medals at the Asian Games 2026',
  call: 'REAL',
  oneLine: '3 independent outlets report this, and none reports otherwise.',
  verdictAt: '2026-10-12T07:00:00.000Z',
  timesChecked: 5,
  firstCheckedAt: '2026-10-06T04:00:00.000Z',
  lastCheckedAt: '2026-10-12T07:00:00.000Z',
  languages: ['en', 'ta'],
  decidedBy: {
    rule: 'corroborated-by-multiple-independent-sources',
    trackRecord: { rule: 'corroborated-by-multiple-independent-sources', n: 38, right: 38, wrong: 0, missed: 0, rate: 1, low: 0.908, high: 1, abstains: false }
  },
  recheckDue: null,
  history: [
    { assessmentId: 'a1', at: '2026-10-06T04:00:00.000Z', trigger: 'user', call: 'CANNOT VERIFY', rule: 'no-independent-coverage', oneLine: 'No independent outlet reports this yet.', changeReason: null, evidence: { for: 0, against: 0, rulings: 0 } },
    { assessmentId: 'a2', at: '2026-10-11T04:00:00.000Z', trigger: 'recheck', call: 'REAL', rule: 'corroborated-by-multiple-independent-sources', oneLine: '3 independent outlets report this, and none reports otherwise.', changeReason: 'Verdict changed from CANNOT VERIFY to REAL on an automatic re-check: 3 new sources confirm it.', evidence: { for: 3, against: 0, rulings: 1 } }
  ],
  evidence: [
    { channel: 'news', side: 'for', source: 'The Hindu', title: 'India ends campaign with 84 medals', url: 'https://example.org/hindu/story', reported: 'confirms it', publishedAt: '2026-10-10' },
    { channel: 'news', side: 'against', source: 'Viral Daily', title: 'India got 85 medals', url: '', reported: 'reports otherwise', publishedAt: '' },
    { channel: 'factcheck', side: 'for', source: 'Factly', title: 'Medal tally', url: 'https://example.org/factly/tally', reported: 'True', publishedAt: '2026-10-11' }
  ],
  variants: [{ claimId: 'claim2', claim: 'India won 85 medals at the Asian Games 2026', call: 'FAKE', differences: ['85 instead of 84'] }]
};

beforeEach(() => {
  jest.clearAllMocks();
  window.scrollTo = jest.fn();
});

const open = async (data = CLAIM) => {
  api.get.mockResolvedValue({ data });
  render(<ClaimDetailPage />);
  return screen.findByRole('heading', { level: 1, name: data.claim });
};

test('the page states the claim, the verdict and the reason for it', async () => {
  await open();
  expect(api.get).toHaveBeenCalledWith('/claims/claim1', { params: {} });
  expect(screen.getAllByText('Real').length).toBeGreaterThan(0);
  // The reason leads the page and is repeated against the check that reached it.
  expect(screen.getByRole('heading', { level: 1 }).parentElement).toHaveTextContent(/3 independent outlets report this, and none reports otherwise\./);
  expect(screen.getByText(/5 times/)).toBeInTheDocument();
  expect(screen.getByText(/Seen in English, Tamil/)).toBeInTheDocument();
});

test('the deciding rule is shown with how often it was right on test messages', async () => {
  await open();
  const decided = screen.getByRole('region', { name: /what decided it/i });
  expect(within(decided).getByText('Independent outlets confirm it')).toBeInTheDocument();
  expect(within(decided).getByText(/38 of 38 test messages/)).toBeInTheDocument();
  expect(within(decided).getByText(/95% range 91% to 100%/)).toBeInTheDocument();
});

test('a rule nothing has been measured on says so rather than showing a figure', async () => {
  await open({ ...CLAIM, decidedBy: { rule: 'some-new-rule', trackRecord: null } });
  expect(screen.getByText(/no measured record/i)).toBeInTheDocument();
});

test('a verdict that was reached by several claims at once names no rule', async () => {
  await open({ ...CLAIM, decidedBy: null });
  expect(screen.queryByRole('region', { name: /what decided it/i })).not.toBeInTheDocument();
});

test('the timeline lists every verdict in order and says why the verdict changed', async () => {
  await open();
  const timeline = screen.getByRole('list', { name: /verdict history/i });
  const entries = within(timeline).getAllByRole('listitem');
  expect(entries).toHaveLength(2);
  expect(within(entries[0]).getByText('Unproven')).toBeInTheDocument();
  expect(within(entries[1]).getByText('Re-checked automatically')).toBeInTheDocument();
  expect(within(entries[1]).getByText(/3 new sources confirm it/)).toBeInTheDocument();
  expect(within(entries[1]).getByText(/3 for, 0 against, 1 fact-check ruling/)).toBeInTheDocument();
  // The first check was not a change; the second was.
  expect(entries[0]).not.toHaveClass('is-change');
  expect(entries[1]).toHaveClass('is-change');
});

test('evidence links open the outlet in a new tab without handing it this page', async () => {
  await open();
  const link = screen.getByRole('link', { name: 'India ends campaign with 84 medals' });
  expect(link).toHaveAttribute('href', 'https://example.org/hindu/story');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.getByRole('link', { name: 'Medal tally' })).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.getByText('Fact-checkers')).toBeInTheDocument();
  expect(screen.getByText('News coverage')).toBeInTheDocument();
});

test('evidence with no address is shown as text, not as a link', async () => {
  await open();
  expect(screen.getByText('India got 85 medals')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'India got 85 medals' })).not.toBeInTheDocument();
});

test('a claim with no stored evidence says so', async () => {
  await open({ ...CLAIM, evidence: [] });
  expect(screen.getByText(/no evidence is on record/i)).toBeInTheDocument();
});

test('a variant links to its own page, with what differs', async () => {
  await open();
  const link = screen.getByRole('link', { name: 'India won 85 medals at the Asian Games 2026' });
  expect(link).toHaveAttribute('href', '/claims/claim2');
  expect(screen.getByText(/85 instead of 84/)).toBeInTheDocument();
});

test('“Check it again” opens the check page with the claim already in its box', async () => {
  await open();
  const again = screen.getByRole('link', { name: /check it again/i });
  expect(again).toHaveAttribute('href', '/check');
  expect(JSON.parse(again.getAttribute('data-state'))).toEqual({ text: CLAIM.claim });
});

test('a claim still waiting for a re-check says when', async () => {
  await open({ ...CLAIM, recheckDue: '2026-10-13T10:00:00.000Z' });
  expect(screen.getByText(/checked again automatically around/i)).toBeInTheDocument();
});

test('a claim that is not on record says so, with no button to retry', async () => {
  api.get.mockRejectedValue({ response: { status: 404, data: { error: 'No record of that claim.' } } });
  render(<ClaimDetailPage />);
  expect(await screen.findByText(/no record of that claim/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /all checked claims/i })).toHaveAttribute('href', '/claims');
});

test('a server failure can be tried again', async () => {
  api.get.mockRejectedValueOnce({ response: { status: 500 } });
  render(<ClaimDetailPage />);
  expect(await screen.findByText(/could not be loaded just now/i)).toBeInTheDocument();

  api.get.mockResolvedValue({ data: CLAIM });
  fireEvent.click(screen.getByRole('button', { name: /try again/i }));
  expect(await screen.findByRole('heading', { level: 1, name: CLAIM.claim })).toBeInTheDocument();
});
