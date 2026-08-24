require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');

const contractsRouter = require('./routes/contracts');
const searchRouter = require('./routes/search');
const { checkSlaBreaches } = require('./services/notify');
const { startBucketPolling } = require('./services/bucketWatcher');
const { runMigrations } = require('./services/migrate');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/contracts', contractsRouter);
app.use('/api/search', searchRouter);
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 3000;

async function start() {
  await runMigrations();

  app.listen(PORT, () => {
    console.log(`CLM tool listening on port ${PORT}`);
  });

  if (process.env.ENABLE_WATCHER !== 'false') {
    startBucketPolling();
  }

  if (process.env.ENABLE_SLA_CRON !== 'false') {
    // Runs daily at 8am, plus once on startup so you see it working immediately.
    cron.schedule('0 8 * * *', () => {
      checkSlaBreaches().catch((err) => console.error('SLA check failed:', err.message));
    });
    checkSlaBreaches().catch((err) => console.error('Initial SLA check failed:', err.message));
  }
}

start();
