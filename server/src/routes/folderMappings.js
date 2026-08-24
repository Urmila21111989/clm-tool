const express = require('express');
const router = express.Router();
const pool = require('../db');

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM folder_mappings ORDER BY prefix');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    let { prefix, doc_type } = req.body;
    if (!prefix || !doc_type) return res.status(400).json({ error: 'prefix and doc_type are required.' });

    // Folder prefixes in S3 need a trailing slash to match correctly.
    if (!prefix.endsWith('/')) prefix += '/';

    const { rows } = await pool.query(
      `INSERT INTO folder_mappings (prefix, doc_type) VALUES ($1, $2)
       ON CONFLICT (prefix) DO UPDATE SET doc_type = EXCLUDED.doc_type
       RETURNING *`,
      [prefix, doc_type]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM folder_mappings WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
