// backend/utils/config.js
//
// Is the server configured well enough to start?
//
// A missing MONGO_URI used to surface as a Mongoose error after the server was
// already listening, and a missing JWT_SECRET only when the first reader tried
// to sign in ("secretOrPrivateKey must have a value", as a 500). Both are now
// found before the server listens, and named.
//
// The JWT secret signs every login token; one short enough to guess lets
// anyone mint a token for any account. In production a weak secret stops the
// server; on a laptop it is a warning, so a development .env keeps working.

// Values that appear in tutorials and .env.example files.
const KNOWN_WEAK = new Set(['secret', 'jwtsecret', 'jwt_secret', 'your_jwt_secret', 'yourjwtsecret', 'changeme', 'change_me',
  'mysecret', 'supersecret', 'secretkey', 'your-secret-key', 'your_secret_key', 'password', 'replace-me']);
const MIN_SECRET = 32;

const isProduction = (env) => env.NODE_ENV === 'production' || Boolean(env.RENDER);

/**
 * @param {Object} [env=process.env]
 * @returns {{errors: string[], warnings: string[]}}
 */
const checkConfig = (env = process.env) => {
  const errors = [];
  const warnings = [];
  const strict = isProduction(env);
  const weakOr = (message) => (strict ? errors : warnings).push(message);

  for (const name of ['MONGO_URI', 'JWT_SECRET']) {
    if (!String(env[name] || '').trim()) errors.push(`${name} is not set.`);
  }

  const secret = String(env.JWT_SECRET || '');
  if (secret && (secret.length < MIN_SECRET || KNOWN_WEAK.has(secret.toLowerCase()) || new Set(secret).size < 8)) {
    weakOr(`JWT_SECRET is too weak: use at least ${MIN_SECRET} random characters (for example: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))").`);
  }

  const key = String(env.INTERNAL_API_KEY || '');
  if (key && key.length < 24) weakOr('INTERNAL_API_KEY is set but shorter than 24 characters; it opens the analysis endpoints without a login.');

  if (!env.NIM_API_KEY && !env.GEMINI_API_KEY && !env.GEMINI_API_KEYS && !env.OLLAMA_HOST) {
    warnings.push('No language model is configured (NIM_API_KEY, GEMINI_API_KEY or OLLAMA_HOST): checks use the laptop when it checks in (scripts/ownModelServer.js), otherwise the pattern rules, and /ready answers 503.');
  } else if (String(env.HOSTED_AI || '').trim().toLowerCase() === 'off' && !env.OLLAMA_HOST) {
    warnings.push('HOSTED_AI=off leaves out Gemini and NIM, and OLLAMA_HOST is not set: checks have a language model only while the laptop is checked in.');
  }
  return { errors, warnings };
};

module.exports = { checkConfig, isProduction, MIN_SECRET };
