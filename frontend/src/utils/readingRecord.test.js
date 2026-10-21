import { render, screen } from '@testing-library/react';
import ReadingRecord from '../components/ReadingRecord';
import { outletRecord, recordSummary, weekStart, weeklyRecord } from './readingRecord';

// Wednesday 22 October 2026, noon local time.
const NOW = new Date(2026, 9, 22, 12).getTime();
const day = (d) => new Date(2026, 9, d, 10).toISOString();
const HISTORY = [
  { articleId: 'u1', source: 'The Hindu', lastViewed: day(21) },
  { articleId: 'u2', source: 'The Hindu', lastViewed: day(20) },
  { articleId: 'u3', source: 'NDTV', lastViewed: day(15) },
  { articleId: 'u4', source: 'Viral Daily', lastViewed: day(14) },
  { articleId: 'u5', source: 'NDTV', lastViewed: day(1) },
];
const VERDICTS = [
  { url: 'u1', call: 'REAL' }, { url: 'u2', call: 'CANNOT VERIFY' }, { url: 'u4', call: 'FAKE' }, { url: 'u5', call: 'PARTLY FALSE' },
];

test('weeks start on Monday and run oldest first, keeping empty ones', () => {
  expect(weekStart(NOW).getDay()).toBe(1);
  const w = weeklyRecord(HISTORY, VERDICTS, { weeks: 4, now: NOW });
  expect(w).toHaveLength(4);
  expect(w.map((x) => x.opened)).toEqual([1, 0, 2, 2]);
  expect(w[3].counts).toMatchObject({ confirmed: 1, unproven: 1 });
  expect(w[2].counts).toMatchObject({ false: 1, unchecked: 1 });
  expect(w[0].counts).toMatchObject({ mixed: 1 });
});

test('a story with no verdict is not checked, never counted as confirmed', () => {
  const rows = outletRecord(HISTORY, VERDICTS);
  // A tie on stories opened goes to the outlet with more of them checked.
  expect(rows.map((r) => r.source)).toEqual(['The Hindu', 'NDTV', 'Viral Daily']);
  expect(rows[1]).toMatchObject({ source: 'NDTV', opened: 2, checked: 1 });
  expect(rows.find((r) => r.source === 'Viral Daily').counts.false).toBe(1);
  expect(recordSummary(HISTORY, VERDICTS)).toBe('1 of 4 checked stories were confirmed, 1 found false, 1 partly false or misleading.');
  expect(recordSummary(HISTORY, [])).toBeNull();
});

test('the record renders its weeks, legend and outlets, with a table for screen readers', () => {
  render(<ReadingRecord history={HISTORY} verdicts={VERDICTS} weeks={4} now={NOW} />);
  expect(screen.getByRole('heading', { name: 'Your reading record' })).toBeInTheDocument();
  expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/2 opened, 1 confirmed, 1 unproven/);
  expect(screen.getByRole('table', { name: /stories opened each week/i })).toBeInTheDocument();
  expect(screen.getByRole('rowheader', { name: 'Viral Daily' })).toBeInTheDocument();
});

test('with nothing read, it says how the record will appear', () => {
  render(<ReadingRecord history={[]} verdicts={[]} />);
  expect(screen.getByText(/open a few stories/i)).toBeInTheDocument();
});
