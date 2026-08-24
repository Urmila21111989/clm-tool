const pool = require('../db');

// The schema lives here directly, rather than in a separate db/init.sql file.
// That file sat outside the "server" folder, which Render's build never
// picked up once Root Directory was set to "server" — inlining it here
// means there's no external file path that can go missing.
const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type TEXT NOT NULL CHECK (doc_type IN ('NDA','MSA','SOW','CHANGE_ORDER','AMENDMENT','UNKNOWN')),
  title TEXT NOT NULL,
  parent_id UUID REFERENCES contracts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  effective_date DATE,
  sla_date DATE,
  approver_email TEXT,
  interested_emails TEXT[] NOT NULL DEFAULT '{}',
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_text TEXT,
  embedding VECTOR(384),
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contracts_attributes ON contracts USING GIN (attributes);
CREATE INDEX IF NOT EXISTS idx_contracts_parent ON contracts(parent_id);
CREATE INDEX IF NOT EXISTS idx_contracts_doctype ON contracts(doc_type);
CREATE INDEX IF NOT EXISTS idx_contracts_sla ON contracts(sla_date);

CREATE TABLE IF NOT EXISTS notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS folder_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prefix TEXT NOT NULL UNIQUE,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('NDA','MSA','SOW','CHANGE_ORDER','AMENDMENT')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seeds your current folder structure so nothing breaks on this upgrade.
-- Add, edit, or remove mappings from the Settings tab from now on.
INSERT INTO folder_mappings (prefix, doc_type) VALUES
  ('MSA/', 'MSA'),
  ('SOW/', 'SOW'),
  ('NDA/', 'NDA'),
  ('Change Orders/', 'CHANGE_ORDER'),
  ('Amendment to MSA/', 'AMENDMENT'),
  ('Amendment to SOW/', 'AMENDMENT')
ON CONFLICT (prefix) DO NOTHING;
`;

async function runMigrations() {
  try {
    await pool.query(SCHEMA_SQL);
    console.log('Database schema is up to date.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    console.error(
      "If this mentions permission for 'CREATE EXTENSION vector', connect with Render's psql shell " +
      "(from your database's dashboard page) and run: CREATE EXTENSION vector; — then restart the service."
    );
  }
}

module.exports = { runMigrations };
