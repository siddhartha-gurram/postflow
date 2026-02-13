/**
 * Connections routes: OAuth connect and callback.
 * @module modules/connections/connection.routes
 */

const express = require('express');
const { requireAuth } = require('../../middleware/auth');

/**
 * @param {import('express').Router} router
 * @param {ReturnType<typeof import('./connection.controller').createConnectionController>} controller
 */
function mountConnectionRoutes(router, controller) {
  router.get('/connect/:providerId', requireAuth, controller.connect);
  router.get('/callback/:providerId', controller.callback);
  return router;
}

module.exports = { mountConnectionRoutes };
