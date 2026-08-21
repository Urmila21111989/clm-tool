# Contract ledger

A self-hosted tool for creating NDAs, MSAs, SOWs, change orders, and amendments;
tracking parent-child relationships between them; searching contract content
with plain-language questions; and getting notified before an SLA date is missed.

This version is set up to run on **Render** (app + database) with **AWS S3**
standing in for your "shared folder" and "personal folder."

## Why these two

- **Render**: predictable pricing, managed Postgres with backups and `pgvector`
  support built in, and no permanent free tier that would let your contract data
  quietly expire. Realistic cost for an always-on setup: **roughly $13-14/month**
  (a Starter web service plus a small Postgres instance) — this is close to the
  floor for something that stays up and keeps your data, not literally free.
- **AWS S3**: the storage most legal/compliance teams already have some
  familiarity with. Unlike Cloudflare R2, S3 does charge for data transferred
  out — at this tool's scale (small text files, polled every couple of
  minutes) that cost should stay negligible, but it's worth knowing it's not
  the zero-egress option R2 was.

## One-time setup

### 1. AWS account, S3 bucket, and IAM user
1. Create an AWS account at **aws.amazon.com** if you don't have one
2. Go to the **S3** service and click **Create bucket**
3. Name it something like `clm-tool-documents`, leave the other settings as
   default, and create it
4. Inside the bucket, create two folders: `shared` and `personal` (S3 calls
   these "folders" even though they're really just key prefixes)
5. Go to the **IAM** service, click **Users**, then **Create user**
6. Name it `clm-tool`, and under permissions, attach a policy that allows
   `s3:GetObject` and `s3:ListBucket` on your bucket specifically (the
   built-in `AmazonS3ReadOnlyAccess` policy also works if you'd rather not
   write a custom one, though it's broader than strictly necessary)
7. After creating the user, go to its **Security credentials** tab and
   click **Create access key** — choose "Application running outside AWS"
   as the use case
8. Copy the **Access Key ID** and **Secret Access Key** shown — like other
   cloud credentials, the secret is only shown once

### 2. Anthropic API key
Get one from [console.anthropic.com](https://console.anthropic.com) — used by
the Ask tab and future auto-classification.

### 3. Deploy to Render
1. Push this project to a GitHub repository (Render deploys from Git).
2. In the Render dashboard, choose **New > Blueprint** and point it at your repo.
   Render reads `render.yaml` and provisions the web service and the database
   together.
3. When prompted, fill in the environment variables marked `sync: false` in
   `render.yaml`: `ANTHROPIC_API_KEY`, `AWS_ACCESS_KEY_ID`,
   `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`, and optionally the `SMTP_*` values if
   you want real emails sent for SLA alerts (leave them blank and notifications
   just print to the Render logs instead).
4. Deploy. Render builds the Docker image, provisions Postgres, and on first
   boot the app automatically creates its own database schema — no manual
   migration step needed.
5. If the logs mention a permission error creating the `vector` extension,
   open your database's page in the Render dashboard, use the provided **psql**
   command, and run:
   ```sql
   CREATE EXTENSION vector;
   ```
   then restart the web service. This can happen because extension creation
   sometimes requires a privilege Render grants per-database rather than by
   default.

Once deployed, Render gives you a `https://your-service.onrender.com` URL —
that's your dashboard.

## Running it locally instead (optional)

The original Docker Compose setup still works for local testing — it now
talks to your real AWS S3 bucket over the internet instead of a local
folder, so ingestion behaves the same way locally as it will in the cloud.

```
cp .env.example .env
# fill in POSTGRES_PASSWORD, ANTHROPIC_API_KEY, and the AWS_* values
docker compose up --build
```

Open **http://localhost:3000**.

## What's included

- **Create** — a form per document type with custom fields you define yourself
  (no fixed schema — fields live in a flexible database column)
- **Ledger** — a searchable, filterable table of everything you've created
- **Lineage** — see a contract's parent and children at a glance
- **Ask** — plain-language questions answered from your contract text via Claude
- **Bucket polling** — new `.txt`/`.md` objects under `shared/` or `personal/`
  in your S3 bucket are ingested automatically as unclassified drafts
- **SLA notifications** — a daily check emails the approver and interested
  parties when a contract's SLA date is close or has passed

## What's intentionally not built yet

- **Email inbox ingestion** — for later, as planned. Adding it means writing
  one more polling service alongside `bucketWatcher.js`, not restructuring
  anything.
- **PDF / Word text extraction** — only `.txt` and `.md` are read directly.
  Add `pdf-parse` and `mammoth` and a short extraction step in
  `bucketWatcher.js` when ready.
- **True semantic search** — the `embedding` column and `pgvector` extension
  are already in place; search today is keyword matching plus Claude
  reasoning over the matches. Upgrading later means generating embeddings on
  save and changing one query in `search.js`.
- **Document generation from templates** — "create" captures structured data;
  it doesn't yet merge that data into a formatted `.docx`.

## How the parent-child rule works

- NDAs and MSAs don't need a parent.
- SOWs must have an MSA as their parent.
- Change orders and amendments must have an SOW or MSA as their parent.
- Anything pulled in automatically from the bucket starts as `UNKNOWN` with
  no parent required, so it lands in the ledger even before you've classified
  it — you link it up from the dashboard afterward.

## Project structure

```
clm-tool/
  render.yaml                 Render blueprint (web service + managed Postgres)
  docker-compose.yml          optional local dev setup
  .env.example                 copy to .env for local runs
  db/init.sql                  database schema (also run automatically on cloud boot)
  server/
    src/index.js                 entry point, runs migrations on boot
    src/routes/contracts.js      create / list / update / delete / parent rules
    src/routes/search.js         the Ask tab's backend
    src/services/notify.js       SLA breach checks + email
    src/services/bucketWatcher.js  S3 polling (shared/personal ingestion)
    src/services/migrate.js      runs db/init.sql on startup
  public/                      the dashboard (plain HTML/CSS/JS, no build step)
```
