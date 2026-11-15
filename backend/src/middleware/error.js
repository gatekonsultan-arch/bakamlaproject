'use strict';
const { ZodError } = require('zod');
const { HttpError } = require('../utils/errors');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      message: 'Data yang dikirim tidak valid',
      errors: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message, ...(err.details || {}) });
  }
  if (err && err.name === 'MulterError') {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Ukuran file terlalu besar'
      : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Jumlah file terlalu banyak / nama field salah'
        : 'Upload gagal';
    return res.status(400).json({ message: msg });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Format JSON tidak valid' });
  }
  // Jangan bocorkan detail error database/stack ke klien.
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ message: 'Terjadi kesalahan pada server' });
}

function notFoundHandler(_req, res) {
  res.status(404).json({ message: 'Endpoint tidak ditemukan' });
}

module.exports = { errorHandler, notFoundHandler };
