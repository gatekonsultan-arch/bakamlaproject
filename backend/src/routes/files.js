'use strict';
const express = require('express');
const fs = require('fs');
const { filePath, verify } = require('../utils/files');
const { notFound } = require('../utils/errors');

const router = express.Router();
const KINDS = new Set(['hse', 'settings', 'signatures']);

// GET /api/files/:kind/:name?t=<token bertanda tangan>
router.get('/:kind/:name', (req, res) => {
  const { kind, name } = req.params;
  const p = verify(req.query.t, 'file');
  if (!KINDS.has(kind) || p.k !== kind || p.n !== name) throw notFound();
  const fp = filePath(kind, name);
  if (!fp || !fs.existsSync(fp)) throw notFound('File tidak ditemukan');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.sendFile(fp);
});

module.exports = router;
