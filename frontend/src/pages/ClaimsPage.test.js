import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ClaimsPage from './ClaimsPage';
import api from '../services/api';

jest.mock('../services/api');
// react-router v7's export map does not resolve under the Jest config CRA
// ships (see CheckPage.test.js), and this page uses one component from it, so
// a link is stood in for by a plain anchor with the same address.
jest.mock('react-router-dom', () => {
  const React = require('react');
  return { Link: ({ to, children, ...rest }) => React.createElement('a', { href: to, ...rest }, children) };
});

const claim = (n, extra = {}) => ({
  claimId: `id${n}`, claim: `Claim number ${n} about the Asian Games`, call: 'REAL', oneLine: 'Reported.',
  verdictAt: '2026-10-12T07:00:00.000Z', timesChecked: n, firstCheckedAt: '2026-10-01T07:00:00.000Z',
  lastCheckedAt: '2026-10-12T07:00:00.000Z', languages: ['en'], ...extra
});

const STATS = {
  claims: 31, checks: 84, checksThisWeek: 14, since: '2026-10-01T00:00:00.000Z',
  calls: { REAL: 10, FAKE: 11, 'PARTLY FALSE': 1, 'CANNOT VERIFY': 9, other: 0 },
  languages: [{ language: 'en', claims: 30 }, { language: 'ta', claims: 15 }]
};

const TRENDING = { windowDays: 7, claims: [claim(7, { claimId: 'hot1', claim: 'Metro fares doubled from Monday', call: 'FAKE', checksThisWeek: 9 })] };
const CHANGES = {
  changes: [{
    claimId: 'chg1', claim: 'India won 84 medals', at: '2026-10-11T04:00:00.000Z', trigger: 'recheck',
    from: 'CANNOT VERIFY', to: 'REAL', changeReason: 'Verdict changed from CANNOT VERIFY to REAL: 3 new sources confirm it.'
  }]
};

// Answers by endpoint; a test overrides the ones it cares about.
const serve = (overrides = {}) => {
  const answers = {
    '/claims/stats': () => Promise.resolve({ data: STATS }),
    '/claims/trending': () => Promise.resolve({ data: TRENDING }),
    '/claims/changes': () => Promise.resolve({ data: CHANGES }),
    '/claims': () => Promise.resolve({ data: { claims: [claim(1), claim(2, { call: 'FAKE', languages: ['ta', 'en'] })], total: 2, limit: 20, nextCursor: null } }),
    ...overrides
  };
  api.get.mockImplementation((url, config) => answers[url](config?.params));
};

const listCalls = () => api.get.mock.calls.filter(([url]) => url === '/claims').map(([, config]) => config.params);

beforeEach(() => {
  jest.clearAllMocks();
});

test('the registry shows its figures, the claims, and the trending and changed sections', async () => {
  serve();
  render(<ClaimsPage />);

  expect(await screen.findByText('Claim number 1 about the Asian Games')).toBeInTheDocument();
  const list = screen.getByRole('list', { name: /checked claims/i });
  expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  expect(within(list).getByText('Fake')).toBeInTheDocument();
  expect(within(list).getByText('Tamil, English')).toBeInTheDocument();
  expect(within(list).getByRole('link', { name: 'Claim number 2 about the Asian Games' })).toHaveAttribute('href', '/claims/id2');

  expect(await screen.findByText('84')).toBeInTheDocument();
  expect(screen.getByText('2 of 2 claims')).toBeInTheDocument();

  const trending = screen.getByRole('region', { name: /trending this week/i });
  expect(within(trending).getByRole('link', { name: 'Metro fares doubled from Monday' })).toHaveAttribute('href', '/claims/hot1');
  expect(within(trending).getByText(/checked 9 times this week/i)).toBeInTheDocument();

  const changed = screen.getByRole('region', { name: /verdicts that changed/i });
  expect(within(changed).getByText(/3 new sources confirm it/i)).toBeInTheDocument();
  expect(within(changed).getByText('Unproven')).toBeInTheDocument();
});

test('searching asks the registry for the words typed', async () => {
  serve();
  render(<ClaimsPage />);
  await screen.findByText('Claim number 1 about the Asian Games');

  fireEvent.change(screen.getByRole('searchbox', { name: /search claims/i }), { target: { value: '  medals india ' } });
  fireEvent.submit(screen.getByRole('search'));

  await waitFor(() => expect(listCalls().pop()).toMatchObject({ q: 'medals india', sort: 'recent', limit: 20 }));
});

test('the verdict filter and the sort order are sent to the registry', async () => {
  serve();
  render(<ClaimsPage />);
  await screen.findByText('Claim number 1 about the Asian Games');

  fireEvent.change(screen.getByLabelText('Verdict'), { target: { value: 'FAKE' } });
  await waitFor(() => expect(listCalls().pop()).toMatchObject({ call: 'FAKE' }));

  fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'checked' } });
  await waitFor(() => expect(listCalls().pop()).toMatchObject({ call: 'FAKE', sort: 'checked' }));
});

test('a verdict in the figures strip filters the list, and pressing it again clears it', async () => {
  serve();
  render(<ClaimsPage />);
  const chip = await screen.findByRole('button', { name: /^Fake 11$/ });

  fireEvent.click(chip);
  await waitFor(() => expect(listCalls().pop()).toMatchObject({ call: 'FAKE' }));
  expect(screen.getByRole('button', { name: /^Fake 11$/ })).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(screen.getByRole('button', { name: /^Fake 11$/ }));
  await waitFor(() => expect(listCalls().pop().call).toBeUndefined());
});

test('more claims are fetched from where the last page ended, and added below it', async () => {
  const first = { claims: [claim(1)], total: 2, limit: 20, nextCursor: 'CURSOR-ONE' };
  const second = { claims: [claim(2)], total: 2, limit: 20, nextCursor: null };
  serve({ '/claims': (params) => Promise.resolve({ data: params.cursor ? second : first }) });
  render(<ClaimsPage />);

  expect(await screen.findByText('1 of 2 claims')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /show more claims/i }));

  expect(await screen.findByText('Claim number 2 about the Asian Games')).toBeInTheDocument();
  expect(screen.getByText('Claim number 1 about the Asian Games')).toBeInTheDocument();
  expect(listCalls().pop()).toMatchObject({ cursor: 'CURSOR-ONE' });
  expect(screen.queryByRole('button', { name: /show more claims/i })).not.toBeInTheDocument();
});

test('a search with no match says so and offers the whole list again', async () => {
  serve({ '/claims': (params) => Promise.resolve({ data: { claims: params.q ? [] : [claim(1)], total: params.q ? 0 : 1, limit: 20, nextCursor: null } }) });
  render(<ClaimsPage />);
  await screen.findByText('Claim number 1 about the Asian Games');

  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zeppelin' } });
  fireEvent.submit(screen.getByRole('search'));
  expect(await screen.findByText(/no checked claim matches that/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /show all claims/i }));
  expect(await screen.findByText('Claim number 1 about the Asian Games')).toBeInTheDocument();
  expect(screen.getByRole('searchbox')).toHaveValue('');
});

test('an empty registry is described as empty, not as a failed search', async () => {
  serve({ '/claims': () => Promise.resolve({ data: { claims: [], total: 0, limit: 20, nextCursor: null } }) });
  render(<ClaimsPage />);
  expect(await screen.findByText(/nothing has been checked yet/i)).toBeInTheDocument();
  expect(screen.queryByText(/no checked claim matches/i)).not.toBeInTheDocument();
});

test('a list that cannot be loaded says so and can be tried again', async () => {
  let fail = true;
  serve({ '/claims': () => (fail ? Promise.reject(new Error('down')) : Promise.resolve({ data: { claims: [claim(1)], total: 1, limit: 20, nextCursor: null } })) });
  render(<ClaimsPage />);

  expect(await screen.findByText(/claims could not be loaded just now/i)).toBeInTheDocument();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: /try again/i }));
  expect(await screen.findByText('Claim number 1 about the Asian Games')).toBeInTheDocument();
});

test('a section that fails does not take the rest of the page with it', async () => {
  serve({ '/claims/trending': () => Promise.reject(new Error('down')), '/claims/stats': () => Promise.reject(new Error('down')) });
  render(<ClaimsPage />);

  expect(await screen.findByText('Claim number 1 about the Asian Games')).toBeInTheDocument();
  expect(await screen.findByText(/trending claims could not be loaded/i)).toBeInTheDocument();
  expect(screen.getByText(/the registry's figures could not be loaded/i)).toBeInTheDocument();
  expect(screen.getByText(/3 new sources confirm it/i)).toBeInTheDocument();
});

// Typing sends a request per pause; the slow answer to an older search must
// not overwrite the answer to the one the reader is looking at.
test('a late answer to an earlier search does not replace the latest one', async () => {
  const pending = {};
  serve({
    '/claims': (params) => (params.q
      ? new Promise((resolve) => { pending[params.q] = resolve; })
      : Promise.resolve({ data: { claims: [], total: 0, limit: 20, nextCursor: null } }))
  });
  render(<ClaimsPage />);
  await screen.findByText(/nothing has been checked yet/i);

  const box = screen.getByRole('searchbox');
  fireEvent.change(box, { target: { value: 'old' } });
  fireEvent.submit(screen.getByRole('search'));
  await waitFor(() => expect(pending.old).toBeDefined());
  fireEvent.change(box, { target: { value: 'new' } });
  fireEvent.submit(screen.getByRole('search'));
  await waitFor(() => expect(pending.new).toBeDefined());

  pending.new({ data: { claims: [claim(5, { claim: 'The newer search result' })], total: 1, limit: 20, nextCursor: null } });
  expect(await screen.findByText('The newer search result')).toBeInTheDocument();
  pending.old({ data: { claims: [claim(6, { claim: 'The stale search result' })], total: 1, limit: 20, nextCursor: null } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByText('The stale search result')).not.toBeInTheDocument();
});
