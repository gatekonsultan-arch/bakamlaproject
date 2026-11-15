'use strict';
const { z } = require('zod');

const password = z
  .string()
  .min(8, 'Password minimal 8 karakter')
  .max(72, 'Password maksimal 72 karakter')
  .regex(/[A-Za-z]/, 'Password harus mengandung huruf')
  .regex(/[0-9]/, 'Password harus mengandung angka');

const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Username minimal 3 karakter')
  .max(50)
  .regex(/^[a-z0-9._-]+$/, 'Username hanya boleh huruf kecil, angka, titik, minus, underscore');

const optionalText = (max) =>
  z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());

const id = z.coerce.number().int().positive();

module.exports = { z, password, username, optionalText, id };
