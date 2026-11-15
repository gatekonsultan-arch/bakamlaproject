'use strict';
const express = require('express');
const fs = require('fs');
const { filePath, verify } = require('../utils/files');
const { notFound } = require('../utils/errors');

const router = express.Router();
const path = require('path');

// Logo bawaan kop laporan. Bukan data pribadi, jadi tanpa token; hanya nama file yang terdaftar.
const DEFAULT_DIR = path.join(__dirname, '..', '..', 'assets', 'logos');
const DEFAULT_FILES = new Set(['logo-prima.png', 'logo-srt.png']);
router.get('/default/:name', (req, res) => {
  if (!DEFAULT_FILES.has(req.params.name)) throw notFound();
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.sendFile(path.join(DEFAULT_DIR, req.params.name));
});

const KINDS = new Set(['hse', 'settings', 'signatures', 'faces']);

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
