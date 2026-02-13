/**
 * Entry: connect MongoDB and Redis, mount routes (with Redis), start HTTP server and optional worker.
 * @module server
 */

const mongoose = require('mongoose');
const Redis = require('ioredis');
const { Worker } = require('bullmq');
const app = require('./app');
const config = require('./config');
const { createPublishProcessor } = require('./jobs/publish.job');

const REDIS_OPTS = { maxRetriesPerRequest: null };

async function main() {
  await mongoose.connect(config.MONGODB_URI);
  const redis = new Redis(config.REDIS_URL, REDIS_OPTS);

  app.set('setupConnectionRoutes')(redis);
  app.set('setupPublishRoutes')(redis);
  const port = process.env.PORT || 3000;
  const server = app.listen(port, () => {
    console.log(`API listening on port ${port}`);
  });

  const worker = new Worker(
    'publish',
    createPublishProcessor(redis),
    { connection: redis, concurrency: 5 }
  );

  worker.on('failed', (job, err) => {
    console.error('Publish job failed', job?.id, job?.data, err.message);
  });

  const shutdown = async () => {
    server.close();
    await worker.close();
    redis.quit();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Startup failed', err);
  process.exit(1);
});
