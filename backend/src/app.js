/**
 * Express app: routes, middleware. No listen.
 * @module app
 */

const express = require('express');
const { mountConnectionRoutes } = require('./modules/connections/connection.routes');
const { createConnectionController } = require('./modules/connections/connection.controller');
const { createConnectionService } = require('./modules/connections/connection.service');
const { TokenService } = require('./modules/connections/token.service');
const { createOAuthStateStore } = require('./modules/connections/oauth-state.store');
const { mountPublishRoutes } = require('./modules/publishing/publish.routes');
const { createPublishQueue } = require('./queues/publish.queue');
const config = require('./config');

const app = express();

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

function setupConnectionRoutes(redis) {
  const oauthStateStore = createOAuthStateStore(redis);
  const tokenService = new TokenService(config.TOKEN_ENCRYPTION_KEY);
  const connectionService = createConnectionService({
    oauthStateStore,
    tokenService,
    frontendUrl: config.FRONTEND_URL,
  });
  const controller = createConnectionController(connectionService);
  const router = express.Router({ mergeParams: true });
  mountConnectionRoutes(router, controller);
  app.use('/connections', router);
}

function setupPublishRoutes(redis) {
  const publishQueue = createPublishQueue(redis);
  const router = express.Router({ mergeParams: true });
  mountPublishRoutes(router, publishQueue);
  app.use('/publish', router);
}

app.set('setupConnectionRoutes', setupConnectionRoutes);
app.set('setupPublishRoutes', setupPublishRoutes);

app.use((err, req, res, next) => {
  const status = err.statusCode || 500;
  const message = err.message || 'Internal server error';
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.code || 'ERROR', message });
});

module.exports = app;
