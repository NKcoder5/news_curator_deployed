// A failed analysis must not become the permanent answer.
//
// Trust reports were stored whatever they said, for fourteen days, keyed on
// the article URL. So an analysis that ran while the model was rate-limited —
// every content check falling back to word patterns, the corroboration search
// never completing — was written down as that article's verdict, and every
// later reader got it instantly. Re-opening the article could not dislodge it,
// because re-opening the article is exactly what hits the cache. Sixteen of
// the seventeen reports in the local cache were records of a failure.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The policy lives in the route module, which pulls in a database connection,
// so the predicate is read out of the source and exercised directly. It is a
// pure function of the report.
// Line endings are normalised: a Windows checkout (core.autocrlf) has CRLF,
// and the marker below is written with a bare newline.
const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'aiRoutes.js'), 'utf8').replace(/\r\n/g, '\n');
const body = source.slice(source.indexOf('const isCompleteReport'), source.indexOf('/**\n * Store a report'));
// eslint-disable-next-line no-new-func
const isCompleteReport = new Function(`${body}; return isCompleteReport;`)();

const COMPLETE = {
  call: 'REAL',
  decision: { rule: 'corroborated-by-multiple-independent-sources' },
  degradedFactors: []
};

test('a report built on checks that ran is kept', () => {
  assert.equal(isCompleteReport(COMPLETE), true);
});

test('a report whose corroboration search never ran is not kept', () => {
  assert.equal(isCompleteReport({
    ...COMPLETE,
    call: 'CANNOT VERIFY',
    decision: { rule: 'verification-unavailable' }
  }), false);
});

test('a report whose checks fell back to word patterns is not kept', () => {
  assert.equal(isCompleteReport({ ...COMPLETE, degradedFactors: ['bias', 'manipulation'] }), false);
});

test('nothing at all is not a report', () => {
  assert.equal(isCompleteReport(null), false);
  assert.equal(isCompleteReport(undefined), false);
});

// A genuine "no other outlet covers this" IS a finding, and is worth keeping.
test('an honest uncorroborated verdict is kept', () => {
  assert.equal(isCompleteReport({
    ...COMPLETE,
    call: 'CANNOT VERIFY',
    decision: { rule: 'no-independent-coverage-established-publisher' }
  }), true);
});
