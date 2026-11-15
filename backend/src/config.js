'use strict';
require('dotenv').config();

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Environment variable ${name} wajib diisi`);
  return v;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  trustProxy: process.env.TRUST_PROXY === '1' ? 1 : false,

  db: {
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    connectString: required('DB_CONNECT_STRING'),
    poolMin: parseInt(process.env.DB_POOL_MIN || '1', 10),
    poolMax: parseInt(process.env.DB_POOL_MAX || '10', 10),
  },

  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN || '12h',
  },
  maxFailedLogins: parseInt(process.env.MAX_FAILED_LOGINS || '5', 10),
  lockMinutes: parseInt(process.env.LOCK_MINUTES || '15', 10),

  timezone: process.env.APP_TIMEZONE || 'Asia/Jakarta',
  maxGpsAccuracyM: parseFloat(process.env.MAX_GPS_ACCURACY_M || '100'),
  rejectMockLocation: (process.env.REJECT_MOCK_LOCATION || 'true') === 'true',
  // Selfie wajah wajib saat check-in/out staf
  requireSelfie: (process.env.REQUIRE_SELFIE || 'true') === 'true',
  facePhotoRetentionDays: parseInt(process.env.FACE_PHOTO_RETENTION_DAYS || '90', 10),
};

if (config.jwt.secret.length < 32 || config.jwt.secret.startsWith('GANTI')) {
  throw new Error('JWT_SECRET harus diganti dengan string acak minimal 32 karakter');
}

module.exports = config;
