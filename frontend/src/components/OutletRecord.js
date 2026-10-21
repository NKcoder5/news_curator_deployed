import { useEffect, useState } from 'react';
import api from '../services/api';
import '../styles/OutletRecord.css';

/** The outlet a link belongs to: its host name without "www.", or null for anything that is not a web link. */
export const hostOf = (url) => {
  try {
    const u = new URL(String(url || ''));
    return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '').toLowerCase() : null;
  } catch (_) {
    return null;
  }
};

const ORDER = [['REAL', 'confirmed'], ['FAKE', 'found false'], ['PARTLY FALSE', 'partly false'], ['MISLEADING', 'misleading'], ['CANNOT VERIFY', 'unproven']];

/** One sentence from an outlet's record, or null when there is nothing to say. */
export const describeOutlet = (record) => {
  if (!record || !record.checks) return null;
  const parts = ORDER.filter(([call]) => record.calls?.[call]).map(([call, label]) => `${record.calls[call]} ${label}`);
  const checks = `${record.checks} ${record.checks === 1 ? 'check' : 'checks'} by readers`;
  return `${checks}${parts.length ? `: ${parts.join(', ')}` : ''}.`;
};

/**
 * What readers' checks of this outlet's pages have concluded so far, beside its published rating. It is
 * the system's own record, shown for the reader to weigh: it never decides a verdict, and below ten
 * checks it says the sample is too small to judge the outlet by.
 */
const OutletRecord = ({ url }) => {
  const host = hostOf(url);
  const [record, setRecord] = useState(null);

  useEffect(() => {
    let live = true;
    setRecord(null);
    if (!host) return undefined;
    api.get(`/claims/outlets/${encodeURIComponent(host)}`)
      .then((res) => { if (live) setRecord(res.data); })
      .catch(() => { if (live) setRecord(null); });
    return () => { live = false; };
  }, [host]);

  const sentence = describeOutlet(record);
  if (!host || !record) return null;
  return (
    <aside className="outlet-record" aria-label={`Our record for ${host}`}>
      <p className="outlet-record__line">
        <span className="outlet-record__label">Our record for {host}</span>{' '}
        {sentence || 'No reader has checked a page from this outlet before.'}
      </p>
      {record.checks > 0 && !record.enough && (
        <p className="outlet-record__note">Fewer than ten checks: too few to judge the outlet by.</p>
      )}
      {record.published && (
        <p className="outlet-record__note">
          Published rating{record.published.name ? ` (${record.published.name})` : ''}: {record.published.score} out of 10.
        </p>
      )}
    </aside>
  );
};

export default OutletRecord;
