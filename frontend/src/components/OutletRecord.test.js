import { render, screen } from '@testing-library/react';
import OutletRecord, { describeOutlet, hostOf } from './OutletRecord';
import api from '../services/api';

jest.mock('../services/api');

test('an outlet is the link\'s host name; anything else has none', () => {
  expect(hostOf('https://www.TheHindu.com/news/x?utm=1')).toBe('thehindu.com');
  expect(hostOf('javascript:alert(1)')).toBeNull();
  expect(hostOf('not a link')).toBeNull();
});

test('the record reads as one sentence, verdicts in a fixed order', () => {
  expect(describeOutlet({ checks: 14, calls: { FAKE: 1, REAL: 11, 'CANNOT VERIFY': 2 } }))
    .toBe('14 checks by readers: 11 confirmed, 1 found false, 2 unproven.');
  expect(describeOutlet({ checks: 0, calls: {} })).toBeNull();
});

test('a small record says it is too small to judge the outlet by, beside the published rating', async () => {
  api.get.mockResolvedValue({ data: { outlet: 'thehindu.com', checks: 3, calls: { REAL: 3 }, enough: false, published: { name: 'The Hindu', score: 8.5 } } });
  render(<OutletRecord url="https://www.thehindu.com/news/a" />);
  expect(await screen.findByText(/3 checks by readers: 3 confirmed/)).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith('/claims/outlets/thehindu.com');
  expect(screen.getByText(/too few to judge the outlet by/)).toBeInTheDocument();
  expect(screen.getByText(/Published rating \(The Hindu\): 8.5 out of 10/)).toBeInTheDocument();
});
