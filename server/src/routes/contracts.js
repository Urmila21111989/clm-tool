const express = require('express');
const router = express.Router();
const pool = require('../db');

// Which parent doc_types are allowed for each child doc_type.
// UNKNOWN (freshly ingested, unclassified) has no restriction so it can
// always be saved first and linked up later from the dashboard.
const PARENT_RULES = {
  NDA: [],
  MSA: [],
  SOW: ['MSA'],
  CHANGE_ORDER: ['SOW', 'MSA'],
  AMENDMENT: ['SOW', 'MSA'],
  UNKNOWN: ['NDA', 'MSA', 'SOW', 'CHANGE_ORDER', 'AMENDMENT'],
};

async function validateParent(doc_type, parent_id) {
  const allowed = PARENT_RULES[doc_type] || [];
  if (!parent_id) {
    if (doc_type !== 'UNKNOWN' && allowed.length > 0) {
      throw new Error(
        `${doc_type} usually needs a parent (${allowed.join(' or ')}). Pass parent_id, or confirm this one truly stands alone.`
      );
    }
    return;
  }
  const { rows } = await pool.query('SELECT doc_type FROM contracts WHERE id = $1', [parent_id]);
  if (rows.length === 0) throw new Error('Parent contract not found.');
  if (doc_type !== 'UNKNOWN' && !allowed.includes(rows[0].doc_type)) {
    throw new Error(`${doc_type} can't have a parent of type ${rows[0].doc_type}. Expected: ${allowed.join(' or ') || 'none'}.`);
  }
}

router.post('/', async (req, res) => {
  try {
    const {
      doc_type, title, parent_id, effective_date, sla_date,
      approver_email, interested_emails, attributes, content_text, source, status,
    } = req.body;

    if (!doc_type || !title) return res.status(400).json({ error: 'doc_type and title are required.' });

    await validateParent(doc_type, parent_id || null);

    const { rows } = await pool.query(
      `INSERT INTO contracts
        (doc_type, title, parent_id, effective_date, sla_date, approver_email, interested_emails, attributes, content_text, source, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        doc_type, title, parent_id || null, effective_date || null, sla_date || null,
        approver_email || null, interested_emails || [], attributes || {}, content_text || null,
        source || 'manual', status || 'draft',
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { doc_type, parent_id, q } = req.query;
    const clauses = [];
    const values = [];

    if (doc_type) { values.push(doc_type); clauses.push(`doc_type = $${values.length}`); }
    if (parent_id) { values.push(parent_id); clauses.push(`parent_id = $${values.length}`); }
    if (q) {
      values.push(`%${q}%`);
      clauses.push(`(title ILIKE $${values.length} OR content_text ILIKE $${values.length} OR attributes::text ILIKE $${values.length})`);
    }

    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const { rows } = await pool.query(`SELECT * FROM contracts ${where} ORDER BY created_at DESC`, values);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM contracts WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found.' });
    const contract = rows[0];

    const { rows: children } = await pool.query(
      'SELECT * FROM contracts WHERE parent_id = $1 ORDER BY created_at', [contract.id]
    );

    let parent = null;
    if (contract.parent_id) {
      const { rows: parentRows } = await pool.query('SELECT * FROM contracts WHERE id = $1', [contract.parent_id]);
      parent = parentRows[0] || null;
    }

    res.json({ ...contract, parent, children });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const {
      title, parent_id, doc_type, effective_date, sla_date,
      approver_email, interested_emails, attributes, status, content_text,
    } = req.body;

    if (doc_type && parent_id !== undefined) {
      await validateParent(doc_type, parent_id);
    }

    const { rows } = await pool.query(
      `UPDATE contracts SET
        title = COALESCE($1, title),
        parent_id = COALESCE($2, parent_id),
        doc_type = COALESCE($3, doc_type),
        effective_date = COALESCE($4, effective_date),
        sla_date = COALESCE($5, sla_date),
        approver_email = COALESCE($6, approver_email),
        interested_emails = COALESCE($7, interested_emails),
        attributes = COALESCE($8, attributes),
        status = COALESCE($9, status),
        content_text = COALESCE($10, content_text),
        updated_at = now()
       WHERE id = $11 RETURNING *`,
      [title, parent_id, doc_type, effective_date, sla_date, approver_email, interested_emails, attributes, status, content_text, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM contracts WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
