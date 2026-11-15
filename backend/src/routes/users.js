'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { z, password, username, optionalText, id } = require('../validation');
const { authenticate, requirePermission, USER_SELECT } = require('../middleware/auth');
const { ROLES, ALL_ROLES } = require('../roles');
const { badRequest, forbidden, notFound, conflict, isUniqueViolation } = require('../utils/errors');
const { audit } = require('../utils/audit');

const router = express.Router();
router.use(authenticate, requirePermission('manageUsers'));

// Role yang hanya boleh dikelola oleh SUPERADMIN.
const PRIVILEGED = [ROLES.SUPERADMIN, ROLES.ADMIN];

function assertCanManageRole(actor, targetRole) {
  if (actor.roleCode !== ROLES.SUPERADMIN && PRIVILEGED.includes(targetRole)) {
    throw forbidden('Hanya Super Admin yang dapat mengelola akun Super Admin / Admin');
  }
}

async function roleIdByCode(code) {
  const r = await db.one('SELECT id FROM roles WHERE code = :code', { code });
  if (!r) throw badRequest('Role tidak dikenal');
  return r.id;
}

async function assertSiteExists(siteId) {
  if (siteId == null) return;
  const s = await db.one('SELECT id FROM sites WHERE id = :id', { id: siteId });
  if (!s) throw badRequest('Lokasi (site) tidak ditemukan');
}

function toDto(u) {
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
    isActive: u.isActive === 1,
  };
}

router.get('/roles', async (_req, res) => {
  const roles = await db.rows('SELECT id, code, name FROM roles ORDER BY id');
  res.json({ roles });
});

router.get('/', async (req, res) => {
  const q = z
    .object({
      search: z.string().trim().max(50).optional(),
      role: z.enum(ALL_ROLES).optional(),
      siteId: id.optional(),
    })
    .parse(req.query);

  const where = [];
  const binds = {};
  if (q.search) {
    where.push('(LOWER(u.username) LIKE :search OR LOWER(u.full_name) LIKE :search)');
    binds.search = `%${q.search.toLowerCase()}%`;
  }
  if (q.role) { where.push('r.code = :role'); binds.role = q.role; }
  if (q.siteId) { where.push('u.site_id = :siteId'); binds.siteId = q.siteId; }

  const list = await db.rows(
    `${USER_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY u.full_name FETCH FIRST 1000 ROWS ONLY`,
    binds,
  );
  res.json({ users: list.map(toDto) });
});

const createSchema = z.object({
  username,
  fullName: z.string().trim().min(1).max(120),
  email: optionalText(120).pipe(z.string().email().nullable().optional()),
  phone: optionalText(30),
  password,
  role: z.enum(ALL_ROLES),
  siteId: id.nullable().optional(),
});

router.post('/', async (req, res) => {
  const data = createSchema.parse(req.body);
  assertCanManageRole(req.user, data.role);
  await assertSiteExists(data.siteId);

  const roleId = await roleIdByCode(data.role);
  const hash = await bcrypt.hash(data.password, 12);
  try {
    const r = await db.query(
      `INSERT INTO users (username, full_name, email, phone, password_hash, role_id, site_id)
       VALUES (:username, :fullName, :email, :phone, :hash, :roleId, :siteId)
       RETURNING id INTO :newId`,
      {
        username: data.username,
        fullName: data.fullName,
        email: data.email ?? null,
        phone: data.phone ?? null,
        hash,
        roleId,
        siteId: data.siteId ?? null,
        newId: { dir: db.oracledb.BIND_OUT, type: db.oracledb.NUMBER },
      },
    );
    const newId = r.outBinds.newId[0];
    await audit(req.user.id, 'USER_CREATE', `id=${newId} username=${data.username} role=${data.role}`, req.ip);
    const u = await db.one(`${USER_SELECT} WHERE u.id = :id`, { id: newId });
    res.status(201).json({ user: toDto(u) });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('Username sudah digunakan');
    throw err;
  }
});

const updateSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  email: optionalText(120).pipe(z.string().email().nullable().optional()),
  phone: optionalText(30),
  role: z.enum(ALL_ROLES).optional(),
  siteId: id.nullable().optional(),
  isActive: z.boolean().optional(),
});

async function loadTarget(actor, targetId) {
  const target = await db.one(`${USER_SELECT} WHERE u.id = :id`, { id: targetId });
  if (!target) throw notFound('User tidak ditemukan');
  assertCanManageRole(actor, target.roleCode);
  return target;
}

router.put('/:id', async (req, res) => {
  const targetId = id.parse(req.params.id);
  const data = updateSchema.parse(req.body);
  const target = await loadTarget(req.user, targetId);

  if (targetId === req.user.id && (data.role !== undefined || data.isActive === false)) {
    throw badRequest('Anda tidak dapat mengubah role atau menonaktifkan akun sendiri');
  }
  if (data.role) assertCanManageRole(req.user, data.role);
  if (data.siteId !== undefined) await assertSiteExists(data.siteId);

  const sets = ['updated_at = SYSTIMESTAMP'];
  const binds = { id: targetId };
  if (data.fullName !== undefined) { sets.push('full_name = :fullName'); binds.fullName = data.fullName; }
  if (data.email !== undefined) { sets.push('email = :email'); binds.email = data.email; }
  if (data.phone !== undefined) { sets.push('phone = :phone'); binds.phone = data.phone; }
  if (data.siteId !== undefined) { sets.push('site_id = :siteId'); binds.siteId = data.siteId; }
  if (data.role !== undefined) { sets.push('role_id = :roleId'); binds.roleId = await roleIdByCode(data.role); }
  if (data.isActive !== undefined) {
    sets.push('is_active = :isActive');
    binds.isActive = data.isActive ? 1 : 0;
  }
  // Perubahan role / status mencabut sesi yang sedang berjalan.
  if ((data.role && data.role !== target.roleCode) || data.isActive === false) {
    sets.push('token_version = token_version + 1');
  }

  await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = :id`, binds);
  await audit(req.user.id, 'USER_UPDATE', `id=${targetId} ${JSON.stringify(data)}`, req.ip);
  const u = await db.one(`${USER_SELECT} WHERE u.id = :id`, { id: targetId });
  res.json({ user: toDto(u) });
});

router.post('/:id/reset-password', async (req, res) => {
  const targetId = id.parse(req.params.id);
  const { newPassword } = z.object({ newPassword: password }).parse(req.body);
  await loadTarget(req.user, targetId);

  const hash = await bcrypt.hash(newPassword, 12);
  await db.query(
    `UPDATE users SET password_hash = :hash, token_version = token_version + 1,
            failed_logins = 0, locked_until = NULL, updated_at = SYSTIMESTAMP
      WHERE id = :id`,
    { hash, id: targetId },
  );
  await audit(req.user.id, 'USER_RESET_PASSWORD', `id=${targetId}`, req.ip);
  res.json({ message: 'Password berhasil direset' });
});

module.exports = router;
