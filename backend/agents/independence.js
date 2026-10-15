// backend/agents/independence.js
//
// How many INDEPENDENT sources actually corroborate a claim?
//
// Counting articles answers the wrong question. A search that returns eight
// items looks like eight confirmations, but it is routinely one: five papers
// printing the same Reuters wire, plus two titles owned by the same group. The
// claim has then been confirmed once, not eight times, and a trust score built
// on the raw count is inflated by a factor of eight.
//
// Nothing in the news API exposes ownership or syndication, so this module is
// where the project supplies it: a curated ownership model (data/ownership.json)
// plus deterministic syndication and near-duplicate detection. No language model
// is involved, and every merge is reported with the reason it happened, so a
// reader — or an examiner — can audit the count.
const fs = require('fs');
const path = require('path');

let ownership = null;

const loadOwnership = () => {
  if (!ownership) {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/ownership.json'), 'utf8'));
    const byOutlet = new Map();
    for (const group of raw.groups) {
      for (const outlet of group.outlets) byOutlet.set(normaliseKey(outlet), group);
    }
    ownership = { ...raw, byOutlet };
  }
  return ownership;
};

/** Lowercase alphanumeric key: "The Wall Street Journal" and "wsj.com/..." both reduce cleanly. */
const normaliseKey = (value) => String(value || '')
  .toLowerCase()
  .replace(/https?:\/\//, '')
  .replace(/^www\./, '')
  .replace(/\.(com|org|net|co\.uk|co\.in|in|io|news)\b.*$/, '')
  .replace(/[^a-z0-9]+/g, '');

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'but', 'is',
  'are', 'was', 'were', 'be', 'been', 'as', 'by', 'with', 'from', 'that', 'this',
  'it', 'its', 'has', 'have', 'had', 'will', 'says', 'said', 'after', 'over', 'new'
]);

/** Content words of a headline, used for near-duplicate detection. */
const contentTokens = (text) => new Set(
  String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t))
);

const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / (a.size + b.size - shared);
};

/** Two headlines this similar are the same copy running in two places. */
const DUPLICATE_THRESHOLD = 0.75;

/**
 * Which ownership group does an outlet belong to?
 * @param {string} outletName
 * @param {string} [url] - used when the outlet name is missing or unhelpful
 * @returns {{groupId: string, groupName: string, isAgency: boolean, isSatire: boolean,
 *            stateAffiliation: string|null, relatedTo: string[], known: boolean}}
 */
const resolveGroup = (outletName, url) => {
  const { byOutlet } = loadOwnership();
  const candidates = [normaliseKey(outletName)];
  if (url) {
    try { candidates.push(normaliseKey(new URL(url).hostname)); } catch (_) { /* not a URL */ }
  }

  for (const key of candidates) {
    const group = key && byOutlet.get(key);
    if (group) {
      return {
        groupId: group.id,
        groupName: group.name,
        isAgency: Boolean(group.isAgency),
        isSatire: Boolean(group.isSatire),
        stateAffiliation: group.stateAffiliation || null,
        relatedTo: group.relatedTo || [],
        known: true
      };
    }
  }

  // An outlet we hold no ownership record for is its own group. That is the
  // honest default: we do not know that it is independent, but we also have no
  // basis for merging it into someone else's.
  const key = candidates.find(Boolean) || 'unknown';
  return {
    groupId: `outlet:${key}`,
    groupName: outletName || 'Unknown outlet',
    isAgency: false,
    isSatire: false,
    stateAffiliation: null,
    relatedTo: [],
    known: false
  };
};

/**
 * Is this item a reprint of an agency wire? Publishers credit the agency in the
 * headline or the standfirst ("NEW DELHI (Reuters) - ..."), which is the only
 * syndication signal available without the full page.
 * @returns {{agency: string, groupId: string}|null}
 */
const detectWireCredit = (item) => {
  const { wireCredits } = loadOwnership();
  const haystack = `${item.title || ''} ${item.description || ''}`.toLowerCase();
  for (const credit of wireCredits) {
    if (credit.patterns.some(pattern => haystack.includes(pattern))) {
      return { agency: credit.agency, groupId: credit.groupId };
    }
  }
  return null;
};

/** Minimal union-find over cluster keys. */
const makeUnionFind = () => {
  const parent = new Map();
  const find = (key) => {
    if (!parent.has(key)) parent.set(key, key);
    while (parent.get(key) !== key) {
      parent.set(key, parent.get(parent.get(key)));
      key = parent.get(key);
    }
    return key;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };
  return { find, union };
};

/**
 * Reduce a list of retrieved articles to the number of genuinely independent
 * sources behind them.
 *
 * @param {Array<{source: string, title: string, description?: string, url?: string, reliability?: number}>} items
 * @returns {{independentCount: number, clusters: Array, mergeNotes: string[], itemCount: number,
 *            bestReliability: number, hasHighQualitySource: boolean, stateOnly: boolean}}
 */
const analyseIndependence = (items = []) => {
  const entries = items.filter(item => item && (item.source || item.url));
  if (entries.length === 0) {
    return {
      independentCount: 0, clusters: [], mergeNotes: [], itemCount: 0,
      bestReliability: 0, hasHighQualitySource: false, stateOnly: false
    };
  }

  const annotated = entries.map((item, index) => {
    const group = resolveGroup(item.source, item.url);
    const wire = detectWireCredit(item);
    // A wire credit outranks the printing outlet: the Hindu and the Indian
    // Express both running the same PTI copy is one source, not two.
    const clusterKey = wire ? `wire:${wire.groupId}` : group.groupId;
    return { index, item, group, wire, clusterKey, tokens: contentTokens(item.title) };
  });

  const uf = makeUnionFind();
  const mergeNotes = [];
  // Wire syndication and the wire agency itself belong to the same source.
  for (const entry of annotated) {
    if (entry.wire) {
      if (annotated.some(other => other.clusterKey === entry.wire.groupId)) {
        uf.union(entry.clusterKey, entry.wire.groupId);
        mergeNotes.push(`${entry.item.source} was syndicated from ${entry.wire.agency}.`);
      }
    }
  }

  // Corporate siblings — outlets that present as separate mastheads under one
  // proprietor.
  for (const entry of annotated) {
    for (const relatedId of entry.group.relatedTo) {
      if (annotated.some(other => other.clusterKey === relatedId)) {
        uf.union(entry.clusterKey, relatedId);
        mergeNotes.push(`${entry.group.groupName} and ${relatedId} share a controlling owner.`);
      }
    }
  }

  // One state apparatus is one source, whatever the brand on the page.
  const byState = new Map();
  for (const entry of annotated) {
    if (!entry.group.stateAffiliation) continue;
    const seen = byState.get(entry.group.stateAffiliation);
    if (seen) {
      uf.union(seen, entry.clusterKey);
      mergeNotes.push(`${entry.group.groupName} is ${entry.group.stateAffiliation} state media — counted with the other ${entry.group.stateAffiliation} state outlets.`);
    } else {
      byState.set(entry.group.stateAffiliation, entry.clusterKey);
    }
  }

  // The same copy running in two places, with no agency credit to reveal it.
  for (let i = 0; i < annotated.length; i++) {
    for (let j = i + 1; j < annotated.length; j++) {
      if (uf.find(annotated[i].clusterKey) === uf.find(annotated[j].clusterKey)) continue;
      const similarity = jaccard(annotated[i].tokens, annotated[j].tokens);
      if (similarity >= DUPLICATE_THRESHOLD) {
        uf.union(annotated[i].clusterKey, annotated[j].clusterKey);
        mergeNotes.push(
          `"${annotated[i].item.source}" and "${annotated[j].item.source}" published near-identical headlines (${Math.round(similarity * 100)}% overlap) — counted once.`
        );
      }
    }
  }

  const clusterMap = new Map();
  for (const entry of annotated) {
    const root = uf.find(entry.clusterKey);
    if (!clusterMap.has(root)) {
      clusterMap.set(root, { id: root, label: null, members: [], reliability: 0, isAgency: false, stateAffiliation: null });
    }
    const cluster = clusterMap.get(root);
    cluster.members.push({
      source: entry.item.source,
      title: entry.item.title,
      url: entry.item.url,
      reliability: Number(entry.item.reliability) || 0,
      viaWire: entry.wire ? entry.wire.agency : null,
      owner: entry.group.known ? entry.group.groupName : null
    });
    cluster.reliability = Math.max(cluster.reliability, Number(entry.item.reliability) || 0);
    cluster.isAgency = cluster.isAgency || entry.group.isAgency || Boolean(entry.wire);
    cluster.stateAffiliation = cluster.stateAffiliation || entry.group.stateAffiliation;
  }

  const clusters = [...clusterMap.values()].map(cluster => {
    const first = cluster.members[0];
    const wire = cluster.members.find(m => m.viaWire);
    cluster.label = wire ? `${wire.viaWire} (wire)` : (first.owner || first.source);
    cluster.collapsedFrom = cluster.members.length;
    return cluster;
  });

  const stateClusters = clusters.filter(c => c.stateAffiliation);

  return {
    itemCount: entries.length,
    independentCount: clusters.length,
    clusters,
    mergeNotes: [...new Set(mergeNotes)],
    bestReliability: clusters.reduce((max, c) => Math.max(max, c.reliability), 0),
    // A cluster containing an outlet with a strong factual record. Two weak
    // sources agreeing is not the same evidence as one strong one.
    hasHighQualitySource: clusters.some(c => c.reliability >= 7.5),
    // Everything that "corroborates" this comes from state media.
    stateOnly: clusters.length > 0 && stateClusters.length === clusters.length
  };
};

module.exports = {
  analyseIndependence,
  resolveGroup,
  detectWireCredit,
  DUPLICATE_THRESHOLD,
  // exported for tests
  _internal: { normaliseKey, contentTokens, jaccard }
};
