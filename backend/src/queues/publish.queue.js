/**
 * Publish queue definition (BullMQ).
 * @module queues/publish.queue
 */

const { Queue } = require('bullmq');

function createPublishQueue(redis) {
  return new Queue('publish', {
    connection: redis,
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: false,
    },
  });
}

module.exports = { createPublishQueue };
