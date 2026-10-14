import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CheckPage from './CheckPage';
import api from '../services/api';

jest.mock('../services/api');
// react-router v7's export map does not resolve under the Jest config CRA
// ships, and the page uses exactly one hook from it — so the hook is stubbed
// rather than dragging a router into a test that does not navigate.
jest.mock('react-router-dom', () => ({ useLocation: () => ({ state: null }) }));

const renderPage = () => render(<CheckPage />);

const typeClaim = (text) => {
  fireEvent.change(screen.getByPlaceholderText(/Paste the message or post here/i), {
    target: { value: text }
  });
};

const submit = () => fireEvent.click(screen.getByRole('button', { name: /check it/i }));

beforeEach(() => {
  jest.clearAllMocks();
});

test('nothing can be submitted until there is something to check', () => {
  renderPage();
  expect(screen.getByRole('button', { name: /check it/i })).toBeDisabled();

  typeClaim('The council approved the plan on Tuesday.');
  expect(screen.getByRole('button', { name: /check it/i })).toBeEnabled();
});

// A refusal is a result, not a failure. The backend returns HTTP 422 for input
// that asserts nothing checkable, and the page must present that as an answer
// with its reason — not as "something went wrong".
test('a refusal is shown as a result, with what is missing', async () => {
  api.post.mockRejectedValue({
    response: {
      status: 422,
      data: {
        checkable: false,
        kind: 'unfalsifiable',
        error: 'This tells the reader what to do but does not say what actually happened.',
        missing: ['who or where it happened', 'when it happened, or a figure']
      }
    }
  });

  renderPage();
  typeClaim('They are hiding the truth from you. Wake up before it is too late and share this.');
  submit();

  expect(await screen.findByText(/nothing to check/i)).toBeInTheDocument();
  expect(screen.getByText(/does not say what actually happened/i)).toBeInTheDocument();
  expect(screen.getByText(/who or where it happened/i)).toBeInTheDocument();
  // A refusal must not be dressed up as a server error.
  expect(screen.queryByText(/could not check that just now/i)).not.toBeInTheDocument();
});

test('a verdict is shown as the answer, with its one-line reason', async () => {
  api.post.mockResolvedValue({
    data: {
      call: 'FAKE',
      oneLine: '2 independent outlets report the opposite of what this says.',
      verdict: 'False',
      verdictLevel: 'false',
      probabilityPercent: 64,
      decision: { call: 'FAKE', grounds: ['Two independent sources conflict with this.'], rule: 'x', confidence: 0.7 },
      factors: [],
      quality: { score: 8.8, level: 'high', label: 'Well written', note: 'n', checks: [] },
      evidence: {}
    }
  });

  renderPage();
  typeClaim('Prime Minister Rahul Gandhi announced a nationwide fuel subsidy on Tuesday.');
  submit();

  expect(await screen.findByText('FAKE')).toBeInTheDocument();
  expect(screen.getByText(/2 independent outlets report the opposite/i)).toBeInTheDocument();
});

// The whole point of separating the two questions: a fabrication that is well
// written must show both, and must not average them into something reassuring.
test('writing quality is reported apart from the verdict', async () => {
  api.post.mockResolvedValue({
    data: {
      call: 'FAKE',
      oneLine: 'Independent outlets report the opposite.',
      verdict: 'False',
      verdictLevel: 'false',
      decision: { call: 'FAKE', grounds: ['g'], rule: 'x', confidence: 0.7 },
      factors: [],
      quality: { score: 8.8, level: 'high', label: 'Well written', note: 'n', checks: [] },
      evidence: {}
    }
  });

  renderPage();
  typeClaim('Prime Minister Rahul Gandhi announced a nationwide fuel subsidy on Tuesday.');
  submit();

  await screen.findByText('FAKE');
  fireEvent.click(screen.getByRole('button', { name: /how is it written/i }));
  expect(await screen.findByText('8.8')).toBeInTheDocument();
  expect(screen.getByText(/says nothing about whether the story is true/i)).toBeInTheDocument();
});

test('a genuine server failure is reported as an error, not as a verdict', async () => {
  api.post.mockRejectedValue({ response: { status: 500, data: { error: 'Failed to analyse that content.' } } });

  renderPage();
  typeClaim('The council approved the riverfront plan on Tuesday in Chennai.');
  submit();

  expect(await screen.findByText(/failed to analyse that content/i)).toBeInTheDocument();
  expect(screen.queryByText(/nothing to check/i)).not.toBeInTheDocument();
});

test('switching input mode clears the previous result', async () => {
  api.post.mockResolvedValue({
    data: {
      call: 'CANNOT VERIFY', oneLine: 'No other outlet is reporting this.',
      verdict: 'Not confirmed', verdictLevel: 'unverified',
      decision: { grounds: ['g'], rule: 'x', confidence: 0.5 },
      factors: [], quality: null, evidence: {}
    }
  });

  renderPage();
  typeClaim('The council approved the riverfront plan on Tuesday in Chennai.');
  submit();
  await screen.findByText('CANNOT VERIFY');

  fireEvent.click(screen.getByRole('tab', { name: /paste a link/i }));
  await waitFor(() => {
    expect(screen.queryByText('CANNOT VERIFY')).not.toBeInTheDocument();
  });
});
