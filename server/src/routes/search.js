const express = require('express');
const router = express.Router();
const pool = require('../db');

// NOTE: this is keyword matching, not true semantic search. It grabs the
// most plausible candidates by literal text match, then lets Claude reason
// over them. It works well once there's a reasonable volume of contracts.
// Swapping in real embeddings later (the `embedding` column is already in
// the schema) improves recall without changing this endpoint's shape.
router.post('/', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required.' });

    const firstWord = query.split(/\s+/).filter(Boolean)[0] || '';
    const { rows: keywordMatches } = await pool.query(
      `SELECT id, doc_type, title, attributes, content_text, effective_date, sla_date
       FROM contracts
       WHERE content_text ILIKE $1 OR title ILIKE $1 OR attributes::text ILIKE $1
       ORDER BY updated_at DESC LIMIT 15`,
      [`%${firstWord}%`]
    );

    let candidates = keywordMatches;
    if (candidates.length === 0) {
      const { rows: recent } = await pool.query(
        `SELECT id, doc_type, title, attributes, content_text, effective_date, sla_date
         FROM contracts ORDER BY updated_at DESC LIMIT 15`
      );
      candidates = recent;
    }

    if (candidates.length === 0) {
      return res.json({ answer: 'There are no contracts in the ledger yet to search.', matched: [] });
    }

    const context = candidates.map(c =>
      `Contract ${c.id} [${c.doc_type}] "${c.title}" — effective ${c.effective_date || 'unknown'}, SLA ${c.sla_date || 'none'}. Attributes: ${JSON.stringify(c.attributes)}. Text excerpt: ${(c.content_text || '').slice(0, 800)}`
    ).join('\n\n');

    const prompt = `You are helping someone search their contract ledger. Answer the question using only information in the candidate contracts below. If nothing answers it, say so plainly rather than guessing. Reference contract titles when you use them.

Question: ${query}

Candidate contracts:
${context}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    const answer = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n') || 'No answer came back — try rephrasing the question.';

    res.json({
      answer,
      matched: candidates.map(c => ({ id: c.id, doc_type: c.doc_type, title: c.title })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
