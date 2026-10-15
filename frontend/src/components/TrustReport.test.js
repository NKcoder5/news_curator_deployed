import { render, screen, fireEvent } from '@testing-library/react';
import TrustReport from './TrustReport';

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
