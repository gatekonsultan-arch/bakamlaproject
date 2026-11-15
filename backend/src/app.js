'use strict';
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { errorHandler, notFoundHandler } = require('./middleware/error');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

app.use(helmet());
app.use(
  cors({
    origin: (origin, cb) => {
      // Aplikasi mobile (tanpa header Origin) & origin yang terdaftar diizinkan.
      if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  }),
);
app.use(express.json({ limit: '100kb' }));
app.use(
  '/api',
  rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }),
);

app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/sites', require('./routes/sites'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/materials', require('./routes/materials'));
app.use('/api/purchase-requests', require('./routes/purchaseRequests'));
app.use('/api/hse-reports', require('./routes/hseReports'));
app.use('/api/files', require('./routes/files'));

app.use('/api', notFoundHandler);
app.use(errorHandler);

module.exports = app;
