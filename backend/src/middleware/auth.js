'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { unauthorized, forbidden } = require('../utils/errors');
const { can } = require('../roles');

function signToken(user) {
  return jwt.sign(
    { sub: String(user.id), role: user.roleCode, tv: user.tokenVersion },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn, algorithm: 'HS256' },
  );
}

const USER_SELECT = `
  SELECT u.id, u.username, u.full_name, u.email, u.phone, u.site_id, u.is_active,
         u.token_version, r.code AS role_code, r.name AS role_name,
         s.name AS site_name
    FROM users u
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN sites s ON s.id = u.site_id`;

/**
 * Verifikasi JWT, lalu cek ke database bahwa user masih aktif dan token
 * belum dicabut (token_version berubah saat ganti/reset password atau
 * akun dinonaktifkan).
 */
async function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(unauthorized());

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
  } catch (_) {
    return next(unauthorized());
  }

  const user = await db.one(`${USER_SELECT} WHERE u.id = :id`, { id: Number(payload.sub) });
  if (!user || user.isActive !== 1 || user.tokenVersion !== payload.tv) {
    return next(unauthorized());
  }
  req.user = user;
  next();
}

/** Middleware pembatas akses berdasarkan permission di roles.js */
function requirePermission(permission) {
  return (req, _res, next) => {
    if (!req.user || !can(req.user.roleCode, permission)) return next(forbidden());
    next();
  };
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    email: u.email,
    phone: u.phone,
    role: u.roleCode,
    roleName: u.roleName,
    siteId: u.siteId,
    siteName: u.siteName,
  };
}

module.exports = { signToken, authenticate, requirePermission, publicUser, USER_SELECT };
