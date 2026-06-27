'use strict';
const { Queue } = require('bullmq');
const { createRedisConnection } = require('../lib/redis');

const connection = createRedisConnection();

const emailQueue = new Queue('email-triage', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 }
  }
});

const calendarQueue = new Queue('calendar-sync', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'fixed', delay: 10000 },
    removeOnComplete: { count: 50 }
  }
});

const schedulerQueue = new Queue('meeting-scheduler', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30000 }
  }
});

module.exports = { emailQueue, calendarQueue, schedulerQueue };
