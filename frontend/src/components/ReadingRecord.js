import { useMemo } from 'react';
import { OUTCOMES, outletRecord, recordSummary, weeklyRecord } from '../utils/readingRecord';
import '../styles/ReadingRecord.css';

const weekLabel = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const describeWeek = (w) => {
  if (!w.opened) return `Week of ${weekLabel(w.start)}: nothing opened.`;
  const found = OUTCOMES.filter((o) => w.counts[o.key]).map((o) => `${w.counts[o.key]} ${o.label.toLowerCase()}`);
  return `Week of ${weekLabel(w.start)}: ${w.opened} opened, ${found.join(', ')}.`;
};

/**
 * What the checks found about the stories this reader opened: a column per week, split by outcome, and
 * the outlets read most with their record. Drawn in the verdict inks with the label beside every
 * colour, and repeated as a table for screen readers.
 */
const ReadingRecord = ({ history, verdicts, weeks = 8, now = Date.now() }) => {
  const record = useMemo(() => weeklyRecord(history, verdicts, { weeks, now }), [history, verdicts, weeks, now]);
  const outlets = useMemo(() => outletRecord(history, verdicts), [history, verdicts]);
  const summary = useMemo(() => recordSummary(history, verdicts), [history, verdicts]);
  const tallest = Math.max(1, ...record.map((w) => w.opened));

  if (!history || history.length === 0) {
    return (
      <section className="reading-record" aria-labelledby="reading-record-title">
        <h2 id="reading-record-title" className="newspaper-section-title">Your reading record</h2>
        <p className="reading-record__empty">Open a few stories and what the checks found about them will appear here, week by week.</p>
      </section>
    );
  }

  return (
    <section className="reading-record" aria-labelledby="reading-record-title">
      <div className="newspaper-section-header">
        <h2 id="reading-record-title" className="newspaper-section-title">Your reading record</h2>
        <span className="newspaper-section-byline">The last {weeks} weeks</span>
      </div>
      <p className="reading-record__summary">{summary || 'None of the stories you opened has been checked yet.'}</p>

      <div className="reading-record__chart" style={{ '--weeks': weeks }} role="img" aria-label={record.map(describeWeek).join(' ')}>
        {record.map((w) => (
          <div key={w.start.toISOString()} className="reading-record__week" title={describeWeek(w)}>
            <span className="reading-record__count tabular">{w.opened || ''}</span>
            <div className="reading-record__bar" style={{ height: `calc((100% - 1.25rem) * ${w.opened / tallest})` }}>
              {OUTCOMES.filter((o) => w.counts[o.key]).map((o) => (
                <span key={o.key} className={`reading-record__seg reading-record__seg--${o.tone}`}
                  style={{ flexGrow: w.counts[o.key] }} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="reading-record__axis" style={{ '--weeks': weeks }} aria-hidden="true">
        {record.map((w) => <span key={w.start.toISOString()}>{weekLabel(w.start)}</span>)}
      </div>
      <ul className="reading-record__legend">
        {OUTCOMES.map((o) => (
          <li key={o.key}><span className={`reading-record__swatch reading-record__seg--${o.tone}`} aria-hidden="true" />{o.label}</li>
        ))}
      </ul>

      <table className="reading-record__sr">
        <caption>Stories opened each week and what the checks found</caption>
        <thead><tr><th scope="col">Week of</th><th scope="col">Opened</th>{OUTCOMES.map((o) => <th key={o.key} scope="col">{o.label}</th>)}</tr></thead>
        <tbody>
          {record.map((w) => (
            <tr key={w.start.toISOString()}><th scope="row">{weekLabel(w.start)}</th><td>{w.opened}</td>{OUTCOMES.map((o) => <td key={o.key}>{w.counts[o.key]}</td>)}</tr>
          ))}
        </tbody>
      </table>

      {outlets.length > 0 && (
        <>
          <h3 className="reading-record__subhead">The outlets you read most</h3>
          <div className="reading-record__table-wrap">
          <table className="reading-record__outlets">
            <thead>
              <tr><th scope="col">Outlet</th><th scope="col">Read</th><th scope="col">Checked</th><th scope="col">Confirmed</th><th scope="col">False</th></tr>
            </thead>
            <tbody>
              {outlets.map((o) => (
                <tr key={o.source}>
                  <th scope="row">{o.source}</th>
                  <td className="tabular">{o.opened}</td>
                  <td className="tabular">{o.checked}</td>
                  <td className="tabular">{o.counts.confirmed}</td>
                  <td className={`tabular${o.counts.false ? ' reading-record__false' : ''}`}>{o.counts.false}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </section>
  );
};

export default ReadingRecord;
