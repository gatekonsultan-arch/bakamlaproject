'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const db = require('../db');
const { z, password } = require('../validation');
const { signToken, authenticate, publicUser, USER_SELECT } = require('../middleware/auth');
const { HttpError, unauthorized, badRequest } = require('../utils/errors');
const { audit } = require('../utils/audit');

const router = express.Router();

// Hash palsu untuk menyamakan waktu respons saat username tidak ada.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' },
});

const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(50),
  password: z.string().min(1).max(200),
});

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password: pwd } = loginSchema.parse(req.body);

  const user = await db.one(
    `SELECT u.id, u.password_hash, u.is_active, u.failed_logins,
            CASE WHEN u.locked_until > SYSTIMESTAMP THEN 1 ELSE 0 END AS is_locked
       FROM users u WHERE u.username = :username`,
    { username },
  );

  if (!user) {
    await bcrypt.compare(pwd, DUMMY_HASH);
    await audit(null, 'LOGIN_FAILED', `username=${username}`, req.ip);
    throw unauthorized('Username atau password salah');
  }
  if (user.isLocked === 1) {
    throw new HttpError(423, `Akun dikunci sementara karena terlalu banyak percobaan gagal. Coba lagi dalam ${config.lockMinutes} menit.`);
  }

  const ok = await bcrypt.compare(pwd, user.passwordHash);
  if (!ok) {
    const failed = user.failedLogins + 1;
    const lock = failed >= config.maxFailedLogins;
    await db.query(
      `UPDATE users
          SET failed_logins = :failed,
              locked_until = CASE WHEN :doLock = 1
                                  THEN SYSTIMESTAMP + NUMTODSINTERVAL(:mins, 'MINUTE')
                                  ELSE locked_until END
        WHERE id = :id`,
      { failed: lock ? 0 : failed, doLock: lock ? 1 : 0, mins: config.lockMinutes, id: user.id },
    );
    await audit(user.id, lock ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED', null, req.ip);
    throw unauthorized('Username atau password salah');
  }
  if (user.isActive !== 1) {
    throw new HttpError(403, 'Akun Anda dinonaktifkan. Hubungi admin.');
  }

  await db.query(
    `UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = SYSTIMESTAMP
      WHERE id = :id`,
    { id: user.id },
  );
  const full = await db.one(`${USER_SELECT} WHERE u.id = :id`, { id: user.id });
  await audit(user.id, 'LOGIN', null, req.ip);

  res.json({ token: signToken(full), user: publicUser(full) });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

const changePwdSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: password,
});

router.post('/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = changePwdSchema.parse(req.body);
  const row = await db.one('SELECT password_hash FROM users WHERE id = :id', { id: req.user.id });
  if (!(await bcrypt.compare(currentPassword, row.passwordHash))) {
    throw badRequest('Password lama salah');
  }
  if (currentPassword === newPassword) throw badRequest('Password baru harus berbeda');

  const hash = await bcrypt.hash(newPassword, 12);
  // token_version dinaikkan -> semua sesi lama otomatis tidak berlaku.
  await db.query(
    `UPDATE users SET password_hash = :hash, token_version = token_version + 1,
            updated_at = SYSTIMESTAMP WHERE id = :id`,
    { hash, id: req.user.id },
  );
  const full = await db.one(`${USER_SELECT} WHERE u.id = :id`, { id: req.user.id });
  await audit(req.user.id, 'CHANGE_PASSWORD', null, req.ip);
  res.json({ message: 'Password berhasil diubah', token: signToken(full) });
});

module.exports = router;
