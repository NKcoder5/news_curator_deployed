/**
 * The claims registry: every claim that has been checked, searchable, with a
 * permanent page for each. Professional fact-checkers publish a database like
 * this; the checks were already being kept, and this makes them readable by
 * anyone, not only the person who ran one.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { listClaims, getTrending, getChanges, getStats } from '../services/claimsApi';
import { VerdictBadge, CALL_NAMES, callClass, formatDate, languageList, languageName, useLoaded } from './ClaimsShared';
import '../styles/Claims.css';

const SIDE_LIST = 5;
const PAGE = 20;
const SORTS = [['recent', 'Most recently checked'], ['checked', 'Most checked']];
const CALLS = Object.entries(CALL_NAMES);

const loadStats = () => getStats();
const loadTrending = () => getTrending(SIDE_LIST);
const loadChanges = () => getChanges(SIDE_LIST);

/** Say which section failed and let the reader try it again, without hiding the rest of the page. */
const SectionStatus = ({ state, retry, empty, label }) => {
  if (state.status === 'loading') return <p className="claims-note" role="status">Loading…</p>;
  if (state.status === 'error') {
    return (
      <p className="claims-note claims-note-error" role="alert">
        {label} could not be loaded. <button type="button" className="claims-link-button" onClick={retry}>Try again</button>
      </p>
    );
  }
  return empty ? <p className="claims-note">{empty}</p> : null;
};

const Stats = ({ onFilter, active }) => {
  const [state, retry] = useLoaded(loadStats);
  const stats = state.data;
  if (state.status !== 'ready') return <div className="claims-stats"><SectionStatus state={state} retry={retry} label="The registry's figures" /></div>;

  const rated = CALLS.map(([call, name]) => ({ call, name, n: stats.calls[call] || 0 }));
  const total = rated.reduce((sum, r) => sum + r.n, 0) + (stats.calls.other || 0);
  return (
    <section className="claims-stats" aria-label="Registry figures">
      <dl className="claims-figures">
        <div><dt>Claims on record</dt><dd>{stats.claims}</dd></div>
        <div><dt>Checks run</dt><dd>{stats.checks}</dd></div>
        <div><dt>Checked this week</dt><dd>{stats.checksThisWeek}</dd></div>
      </dl>
      {total > 0 && (
        <div className="claims-split">
          <div className="claims-split-bar" role="img" aria-label={rated.map(r => `${r.n} ${r.name.toLowerCase()}`).join(', ')}>
            {rated.filter(r => r.n > 0).map(r => (
              <span key={r.call} className={`claims-split-part ${callClass(r.call)}`} style={{ flexGrow: r.n }} />
            ))}
          </div>
          <ul className="claims-split-legend">
            {rated.map(r => (
              <li key={r.call}>
                <button type="button" className={`claims-chip${active === r.call ? ' is-active' : ''}`}
                  aria-pressed={active === r.call} onClick={() => onFilter(active === r.call ? '' : r.call)}>
                  {r.name} <strong>{r.n}</strong>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {stats.languages.length > 0 && (
        <p className="claims-languages">
          Read in {stats.languages.map((l, i) => (
            <span key={l.language}>{i > 0 ? ', ' : ''}{languageName(l.language)} <span className="claims-count">({l.claims})</span></span>
          ))}
        </p>
      )}
    </section>
  );
};

const Trending = () => {
  const [state, retry] = useLoaded(loadTrending);
  const claims = state.data?.claims || [];
  return (
    <section className="claims-side-section" aria-labelledby="claims-trending">
      <h2 id="claims-trending" className="claims-side-title">Trending this week</h2>
      <SectionStatus state={state} retry={retry} label="Trending claims" empty={state.status === 'ready' && !claims.length ? 'No claim has been checked this week.' : ''} />
      <ol className="claims-side-list">
        {claims.map(c => (
          <li key={c.claimId}>
            <Link to={`/claims/${c.claimId}`} className="claims-side-claim">{c.claim}</Link>
            <span className="claims-side-meta">
              <VerdictBadge call={c.call} /> checked {c.checksThisWeek} {c.checksThisWeek === 1 ? 'time' : 'times'} this week
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
};

const Changes = () => {
  const [state, retry] = useLoaded(loadChanges);
  const changes = state.data?.changes || [];
  return (
    <section className="claims-side-section" aria-labelledby="claims-changes">
      <h2 id="claims-changes" className="claims-side-title">Verdicts that changed</h2>
      <SectionStatus state={state} retry={retry} label="Changed verdicts" empty={state.status === 'ready' && !changes.length ? 'No verdict has changed yet.' : ''} />
      <ol className="claims-side-list">
        {changes.map(c => (
          <li key={`${c.claimId}-${c.at}`}>
            <Link to={`/claims/${c.claimId}`} className="claims-side-claim">{c.claim}</Link>
            <span className="claims-side-meta">
              {c.from && <><VerdictBadge call={c.from} /> <span aria-label="became">→</span> </>}
              <VerdictBadge call={c.to} /> <span className="claims-when">{formatDate(c.at)}</span>
            </span>
            <span className="claims-side-reason">{c.changeReason}</span>
          </li>
        ))}
      </ol>
    </section>
  );
};

const ClaimRow = ({ claim }) => (
  <li className="claims-row">
    <Link to={`/claims/${claim.claimId}`} className="claims-row-claim">{claim.claim}</Link>
    <div className="claims-row-meta">
      <VerdictBadge call={claim.call} />
      <span>Checked <strong>{claim.timesChecked}</strong> {claim.timesChecked === 1 ? 'time' : 'times'}</span>
      <span>Last checked {formatDate(claim.lastCheckedAt)}</span>
      {claim.languages.length > 0 && <span>{languageList(claim.languages)}</span>}
    </div>
  </li>
);

const ClaimsPage = () => {
  const [text, setText] = useState('');
  const [filters, setFilters] = useState({ q: '', call: '', sort: 'recent' });
  const [list, setList] = useState({ status: 'loading', claims: [], total: 0, next: null, more: false, moreFailed: false });
  const [attempt, setAttempt] = useState(0);
  // Only the newest request may write the list: a slow answer to "ind" must
  // not replace the answer to "india won".
  const newest = useRef(0);

  // Typing searches after a pause; Enter or the button searches at once.
  useEffect(() => {
    const timer = setTimeout(() => setFilters(f => (f.q === text.trim() ? f : { ...f, q: text.trim() })), 350);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    const request = ++newest.current;
    setList(l => ({ ...l, status: 'loading', claims: [], next: null, moreFailed: false }));
    listClaims({ ...filters, limit: PAGE }).then(
      (page) => request === newest.current && setList({ status: 'ready', claims: page.claims, total: page.total, next: page.nextCursor, more: false, moreFailed: false }),
      () => request === newest.current && setList(l => ({ ...l, status: 'error' }))
    );
  }, [filters, attempt]);

  const loadMore = useCallback(() => {
    const request = ++newest.current;
    setList(l => ({ ...l, more: true, moreFailed: false }));
    listClaims({ ...filters, limit: PAGE, cursor: list.next }).then(
      (page) => request === newest.current && setList(l => ({ ...l, claims: [...l.claims, ...page.claims], total: page.total, next: page.nextCursor, more: false })),
      () => request === newest.current && setList(l => ({ ...l, more: false, moreFailed: true }))
    );
  }, [filters, list.next]);

  const search = (event) => {
    event.preventDefault();
    setFilters(f => ({ ...f, q: text.trim() }));
  };
  const setCall = (call) => setFilters(f => ({ ...f, call }));
  const clear = () => { setText(''); setFilters(f => ({ ...f, q: '', call: '' })); };
  const narrowed = Boolean(filters.q || filters.call);

  return (
    <div className="press-sheet claims-page">
      <header className="press-masthead">
        <div className="press-dateline">The Public Record</div>
        <h1 className="press-name">Claims Registry</h1>
        <div className="press-tagline">Every claim we have checked, the evidence behind each verdict, and what changed.</div>
      </header>

      <Stats onFilter={setCall} active={filters.call} />

      <form className="claims-controls" onSubmit={search} role="search">
        <div className="claims-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search" className="press-input" value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Search claims, for example “medals” or “metro fares”" aria-label="Search claims" maxLength={100}
          />
        </div>
        <label className="claims-select">
          <span>Verdict</span>
          <select className="press-input" value={filters.call} onChange={(e) => setCall(e.target.value)}>
            <option value="">All verdicts</option>
            {CALLS.map(([call, name]) => <option key={call} value={call}>{name}</option>)}
          </select>
        </label>
        <label className="claims-select">
          <span>Sort by</span>
          <select className="press-input" value={filters.sort} onChange={(e) => setFilters(f => ({ ...f, sort: e.target.value }))}>
            {SORTS.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
          </select>
        </label>
        <button type="submit" className="press-btn">Search</button>
      </form>

      <div className="claims-layout">
        <main className="claims-main">
          {list.status === 'ready' && (
            <p className="claims-count-line" role="status">
              {list.total === 0 ? 'No claims' : `${list.claims.length} of ${list.total} ${list.total === 1 ? 'claim' : 'claims'}`}
              {narrowed ? ' match' : ''}
            </p>
          )}
          {list.status === 'loading' && <p className="claims-note" role="status">Loading claims…</p>}
          {list.status === 'error' && (
            <div className="press-error claims-error" role="alert">
              <p className="claims-error-text">The claims could not be loaded just now.</p>
              <button type="button" className="press-btn press-btn-sm" onClick={() => setAttempt(n => n + 1)}>Try again</button>
            </div>
          )}
          {list.status === 'ready' && list.claims.length === 0 && (
            <div className="press-empty">
              {narrowed ? (
                <>
                  <p>No checked claim matches that.</p>
                  <button type="button" className="press-btn press-btn-outline press-btn-sm" onClick={clear}>Show all claims</button>
                </>
              ) : (
                <p>Nothing has been checked yet. Claims appear here as soon as the first one is.</p>
              )}
            </div>
          )}
          {list.claims.length > 0 && (
            <ol className="claims-list" aria-label="Checked claims">
              {list.claims.map(c => <ClaimRow key={c.claimId} claim={c} />)}
            </ol>
          )}
          {list.moreFailed && <p className="claims-note claims-note-error" role="alert">More claims could not be loaded.</p>}
          {list.status === 'ready' && list.next && (
            <div className="claims-more">
              <button type="button" className="press-btn press-btn-outline" onClick={loadMore} disabled={list.more}>
                {list.more ? 'Loading…' : list.moreFailed ? 'Try again' : 'Show more claims'}
              </button>
            </div>
          )}
        </main>

        <aside className="claims-aside">
          <Trending />
          <Changes />
        </aside>
      </div>
    </div>
  );
};

export default ClaimsPage;
