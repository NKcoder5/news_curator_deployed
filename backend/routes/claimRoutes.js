// backend/routes/claimRoutes.js
//
// The public claims registry (services/claimRegistry.js): read-only, and open
// to anyone, because a fact-check that only its asker can see checks nothing
// for anyone else. It serves claims, verdicts and evidence; the registry
// service decides what may leave, so a route here can only return what it was
// given.
const express = require('express');

// A verdict can change within the hour, but not within the minute, and the
// lists are aggregations the database should not repeat for every page view.
const CACHE = 'public, max-age=60';

const buildRouter = (registry) => {
  const router = express.Router();

  const serve = (read) => async (req, res) => {
    try {
      const body = await read(req);
      if (body === null) return res.status(404).json({ error: 'No record of that claim.' });
      res.set('Cache-Control', CACHE);
      res.json(body);
    } catch (err) {
      // A refusal the registry chose to make (bad input, database down) is
      // worded for the reader; anything else is ours to log, not theirs to read.
      if (err instanceof registry.RegistryError) return res.status(err.status).json({ error: err.message });
      console.error('Claims registry error:', err.message);
      res.status(500).json({ error: 'Could not read the claims registry.' });
    }
  };

  // The fixed paths come before /:id, which would otherwise take them for ids.
  router.get('/', serve(req => registry.listClaims(req.query)));
  router.get('/trending', serve(req => registry.trendingClaims(req.query)));
  router.get('/changes', serve(req => registry.changedVerdicts(req.query)));
  router.get('/stats', serve(() => registry.registryStats()));
  router.get('/outlets/:host', serve(req => registry.outletRecord(req.params.host)));
  router.get('/:id', serve(req => registry.claimDetail(req.params.id)));

  return router;
};

module.exports = buildRouter(require('../services/claimRegistry'));
module.exports.buildRouter = buildRouter;
