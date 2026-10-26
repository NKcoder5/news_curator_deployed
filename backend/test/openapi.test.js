// The API reference must describe the API that exists.
//
// docs/api/openapi.json is what a front-end developer, an examiner or an
// integrator reads instead of the route files. A reference that lags the code
// is worse than none, so this test reads the route files and app.js the way a
// person would — which router is mounted where, which routes sit behind a
// login — and fails when the reference omits a route, invents one, or says a
// route is open when the code protects it (or the reverse).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { VERDICT_CLASSES } = require('../agents/verdictEngine');

const BACKEND = path.join(__dirname, '..');
const SPEC = JSON.parse(fs.readFileSync(path.join(BACKEND, '..', 'docs', 'api', 'openapi.json'), 'utf8'));
const METHODS = ['get', 'post', 'put', 'delete', 'patch'];

const read = (file) => fs.readFileSync(path.join(BACKEND, file), 'utf8').replace(/\r\n/g, '\n');
const joinPath = (prefix, route) => (prefix + (route === '/' ? '' : route)) || '/';
const asOpenApi = (p) => p.replace(/:([A-Za-z_]\w*)/g, '{$1}');

/**
 * Every route the server registers: [{ method, path, protectedBy }], found by
 * reading app.js for the mounts and each mounted file for its routes.
 */
const discoverRoutes = () => {
  const app = read('app.js');
  const files = {};
  for (const m of app.matchAll(/const\s+(\w+)\s*=\s*require\('\.\/routes\/(\w+)'\)/g)) files[m[1]] = m[2];

  const routes = [];
  for (const m of app.matchAll(/app\.(get|post|put|delete|patch)\(\s*'([^']+)'([^\n]*)/g)) {
    routes.push({ method: m[1], path: m[2], protectedBy: /\binternalOnly\b/.test(m[3]) ? ['internalOnly'] : [] });
  }

  for (const m of app.matchAll(/app\.use\(\s*'([^']+)'\s*,([^;]*)\)\s*;/g)) {
    const [, prefix, args] = m;
    const inline = args.match(/require\('\.\/routes\/(\w+)'\)/);
    const named = Object.keys(files).find(name => new RegExp(`\\b${name}\\b`).test(args));
    const file = inline ? inline[1] : files[named];
    if (!file) continue;
    const mountGuards = ['apiAccess', 'authMiddleware'].filter(g => new RegExp(`\\b${g}\\b`).test(args));
    const source = read(`routes/${file}.js`);
    for (const r of source.matchAll(/router\.(get|post|put|delete|patch)\(\s*'([^']+)'([^\n]*)/g)) {
      const guards = ['authMiddleware'].filter(g => r[3].includes(g));
      routes.push({ method: r[1], path: joinPath(prefix, r[2]), protectedBy: [...mountGuards, ...guards] });
    }
  }
  return routes;
};

const documented = () => {
  const ops = [];
  for (const [p, item] of Object.entries(SPEC.paths)) {
    for (const method of METHODS) if (item[method]) ops.push({ method, path: p, op: item[method] });
  }
  return ops;
};

const ROUTES = discoverRoutes();
const find = (method, p) => documented().find(d => d.method === method && d.path === p);

test('the route discovery itself finds the routes (guard against a silent parser failure)', () => {
  // 23 today: /health, 2 news, 11 analysis, 3 auth, 2 tracking, 2 history, 2 profile.
  assert.ok(ROUTES.length >= 23, `only ${ROUTES.length} routes found`);
  assert.ok(ROUTES.some(r => r.method === 'post' && r.path === '/api/ai/analyze-content'));
  assert.ok(ROUTES.some(r => r.method === 'get' && r.path === '/health'));
});

test('every route the server registers is in the API reference', () => {
  const missing = ROUTES.filter(r => !find(r.method, asOpenApi(r.path))).map(r => `${r.method.toUpperCase()} ${r.path}`);
  assert.deepStrictEqual(missing, [], `not documented in docs/api/openapi.json: ${missing.join(', ')}`);
});

test('every documented operation exists in the code', () => {
  const have = new Set(ROUTES.map(r => `${r.method} ${asOpenApi(r.path)}`));
  // Operations marked x-pending-merge were documented ahead of the stream that
  // adds them. Once the claims router exists they are held to the same rule,
  // and the mark should be removed.
  const claimsMerged = fs.existsSync(path.join(BACKEND, 'routes', 'claimRoutes.js'));
  const invented = documented()
    .filter(d => !d.op['x-pending-merge'] || claimsMerged)
    .filter(d => !have.has(`${d.method} ${d.path}`))
    .map(d => `${d.method.toUpperCase()} ${d.path}`);
  assert.deepStrictEqual(invented, [], `documented but not registered: ${invented.join(', ')}`);
});

test('the reference says a route needs a login exactly when the code requires one', () => {
  const wrong = [];
  for (const r of ROUTES) {
    const d = find(r.method, asOpenApi(r.path));
    if (!d) continue;
    const declared = (d.op.security || []).flatMap(s => Object.keys(s));
    const label = `${r.method.toUpperCase()} ${r.path}`;
    if (r.protectedBy.length === 0 && declared.length > 0) wrong.push(`${label} is open but documented as protected`);
    if (r.protectedBy.length > 0 && declared.length === 0) wrong.push(`${label} is protected (${r.protectedBy}) but documented as open`);
    if (r.protectedBy.includes('apiAccess') && !(declared.includes('bearerAuth') && declared.includes('internalKey'))) {
      wrong.push(`${label} accepts a login or the internal key; the reference must list both`);
    }
    if (r.protectedBy.includes('authMiddleware') && !r.protectedBy.includes('apiAccess') && declared.join() !== 'bearerAuth') {
      wrong.push(`${label} takes a login only; the reference must list bearerAuth alone`);
    }
    if (r.protectedBy.includes('internalOnly') && declared.join() !== 'internalKey') {
      wrong.push(`${label} takes the internal key only; the reference must list internalKey alone`);
    }
  }
  assert.deepStrictEqual(wrong, []);
});

test('the reference is a well-formed OpenAPI 3.1 document', () => {
  assert.match(SPEC.openapi, /^3\.1\./);
  assert.ok(SPEC.info.title && SPEC.info.version);

  const ids = documented().map(d => d.op.operationId);
  assert.ok(ids.every(Boolean), 'every operation needs an operationId');
  assert.strictEqual(new Set(ids).size, ids.length, 'operationIds must be unique');
  for (const d of documented()) {
    assert.ok(d.op.summary, `${d.method} ${d.path} needs a summary`);
    assert.ok(d.op.responses && Object.keys(d.op.responses).length > 0, `${d.method} ${d.path} needs responses`);
  }

  // Every $ref must point at something that exists.
  const dangling = [];
  const walk = (node, where) => {
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${where}[${i}]`));
    if (!node || typeof node !== 'object') return;
    if (typeof node.$ref === 'string') {
      const target = node.$ref.replace(/^#\//, '').split('/').reduce((o, k) => (o ? o[k] : undefined), SPEC);
      if (target === undefined) dangling.push(`${where} -> ${node.$ref}`);
    }
    for (const [k, v] of Object.entries(node)) walk(v, `${where}.${k}`);
  };
  walk(SPEC, '#');
  assert.deepStrictEqual(dangling, []);
});

test('the reference lists the same calls, classes and levels as the verdict engine', () => {
  // The values a client switches on are the ones most likely to be changed in
  // the engine and forgotten here.
  const classes = Object.entries(VERDICT_CLASSES);
  const sorted = (xs) => [...new Set(xs)].sort();
  const schemas = SPEC.components.schemas;
  assert.deepStrictEqual(sorted(schemas.Call.enum), sorted(classes.map(([, c]) => c.call)));
  assert.deepStrictEqual(sorted(schemas.VerdictClass.enum), sorted(classes.map(([k]) => k)));
  assert.deepStrictEqual(sorted(schemas.VerdictLevel.enum), sorted(classes.map(([, c]) => c.level)));
});

test('the Check Anything response documents the fields the page reads', () => {
  const report = SPEC.components.schemas.CheckAnythingReport;
  const extras = report.allOf[1].properties;
  for (const field of ['oneLineLocal', 'memory', 'explanation', 'trackRecord', 'ingestNotes', 'readText', 'cached']) {
    assert.ok(extras[field], `CheckAnythingReport.${field}`);
  }
  const trust = SPEC.components.schemas.TrustReport.properties;
  for (const field of ['call', 'oneLine', 'decision', 'evidence', 'factChecks', 'currentCoverage', 'premiseCheck', 'understanding', 'factors']) {
    assert.ok(trust[field], `TrustReport.${field}`);
  }
  const explanation = SPEC.components.schemas.Explanation.properties;
  for (const field of ['verdict', 'decisive', 'restsOn', 'restsOnChannels', 'withoutAll', 'fromAbsence', 'wouldChange']) {
    assert.ok(explanation[field], `Explanation.${field}`);
  }
  const memoryClaim = SPEC.components.schemas.Memory.properties.claims.items.properties;
  for (const field of ['claimId', 'claim', 'timesSeen', 'previous', 'recheckDue', 'variants']) {
    assert.ok(memoryClaim[field], `Memory.claims[].${field}`);
  }
});
