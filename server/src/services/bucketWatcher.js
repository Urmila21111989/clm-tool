const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const pool = require('../db');

function buildClient() {
  if (!process.env.AWS_ACCESS_KEY_ID) return null;
  return new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

// Two prefixes inside one bucket stand in for "shared" and "personal" folders:
//   shared/some-file.txt
//   personal/some-file.txt
async function pollPrefix(client, prefix, sourceLabel) {
  const bucket = process.env.S3_BUCKET;
  const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
  const objects = listed.Contents || [];

  for (const obj of objects) {
    const key = obj.Key;
    const ext = key.slice(key.lastIndexOf('.')).toLowerCase();
    if (!['.txt', '.md'].includes(ext)) continue; // PDFs/Word need extraction first

    const title = key.slice(prefix.length).replace(/\.(txt|md)$/i, '');
    if (!title) continue;

    const exists = await pool.query('SELECT 1 FROM contracts WHERE title = $1 AND source = $2', [title, sourceLabel]);
    if (exists.rows.length) continue; // already ingested

    try {
      const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const text = await streamToString(got.Body);
      await pool.query(
        `INSERT INTO contracts (doc_type, title, content_text, source, status, attributes)
         VALUES ('UNKNOWN', $1, $2, $3, 'needs_review', '{}'::jsonb)`,
        [title, text, sourceLabel]
      );
      console.log(`Ingested ${key} as an unclassified draft — set its type and link it to a parent from the dashboard.`);
    } catch (err) {
      console.error(`Couldn't ingest ${key}:`, err.message);
    }
  }
}

function startBucketPolling() {
  const client = buildClient();
  if (!client) {
    console.log('AWS credentials not set — S3 bucket polling is disabled.');
    return;
  }

  const intervalMinutes = Number(process.env.BUCKET_POLL_MINUTES || 2);
  const run = () => {
    pollPrefix(client, 'shared/', 'shared_folder').catch((err) => console.error('Shared prefix poll failed:', err.message));
    pollPrefix(client, 'personal/', 'personal_folder').catch((err) => console.error('Personal prefix poll failed:', err.message));
  };

  run();
  setInterval(run, intervalMinutes * 60 * 1000);
}

module.exports = { startBucketPolling };
