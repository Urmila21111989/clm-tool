const fs = require('fs');
const path = require('path');
const pool = require('../db');

async function runMigrations() {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'db', 'init.sql'), 'utf-8');
  try {
    await pool.query(sql);
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
