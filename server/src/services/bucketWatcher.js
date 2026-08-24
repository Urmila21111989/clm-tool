const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const pdfParse = require('pdf-parse');
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

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Your bucket is organized by document type rather than "shared"/"personal" —
// each folder here maps directly to the doc_type it should be saved as.
const FOLDER_DOC_TYPES = {
  'MSA/': 'MSA',
  'SOW/': 'SOW',
  'NDA/': 'NDA',
  'Change Orders/': 'CHANGE_ORDER',
  'Amendments/': 'AMENDMENT',
};

const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.pdf'];

async function extractText(buffer, ext) {
  if (ext === '.pdf') {
    const parsed = await pdfParse(buffer);
    return parsed.text;
  }
  return buffer.toString('utf-8');
}

async function pollPrefix(client, prefix, docType) {
  const bucket = process.env.S3_BUCKET;
  const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
  const objects = listed.Contents || [];
  const sourceLabel = `s3_${docType.toLowerCase()}`;

  for (const obj of objects) {
    const key = obj.Key;
    const ext = key.slice(key.lastIndexOf('.')).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      console.log(`Skipping ${key} — unsupported file type (only .txt, .md, and .pdf are read right now).`);
      continue;
    }

    const title = key.slice(prefix.length).replace(/\.(txt|md|pdf)$/i, '');
    if (!title) continue; // skip the folder marker itself

    const exists = await pool.query('SELECT 1 FROM contracts WHERE title = $1 AND source = $2', [title, sourceLabel]);
    if (exists.rows.length) continue; // already ingested

    try {
      const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const buffer = await streamToBuffer(got.Body);
      const text = await extractText(buffer, ext);

      // S3 lowercases custom metadata keys automatically, so a key you
      // named "Parent" when uploading shows up here as "parent".
      let parentId = null;
      const parentTitle = got.Metadata && got.Metadata.parent;
      if (parentTitle) {
        const { rows: parentRows } = await pool.query('SELECT id FROM contracts WHERE title = $1 LIMIT 1', [parentTitle]);
        if (parentRows.length) {
          parentId = parentRows[0].id;
        } else {
          console.log(`"${key}" named a parent ("${parentTitle}") that doesn't exist yet — saved without a parent link. Link it manually once the parent exists.`);
        }
      }

      await pool.query(
        `INSERT INTO contracts (doc_type, title, content_text, source, status, attributes, parent_id)
         VALUES ($1, $2, $3, $4, 'needs_review', '{}'::jsonb, $5)`,
        [docType, title, text, sourceLabel, parentId]
      );
      console.log(`Ingested ${key} as a ${docType} draft${parentId ? ' with parent linked automatically' : ' — link it to a parent from the dashboard if it needs one'}.`);
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
    Object.entries(FOLDER_DOC_TYPES).forEach(([prefix, docType]) => {
      pollPrefix(client, prefix, docType).catch((err) => console.error(`Poll of "${prefix}" failed:`, err.message));
    });
  };

  run();
  setInterval(run, intervalMinutes * 60 * 1000);
}

module.exports = { startBucketPolling };
