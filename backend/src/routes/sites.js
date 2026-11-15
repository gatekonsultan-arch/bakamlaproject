'use strict';
const express = require('express');
const db = require('../db');
const { z, optionalText, id } = require('../validation');
const { authenticate, requirePermission } = require('../middleware/auth');
const { can } = require('../roles');
const { notFound } = require('../utils/errors');
const { audit } = require('../utils/audit');

const router = express.Router();
router.use(authenticate);

const SELECT = `SELECT id, name, address, latitude, longitude, radius_m, is_active FROM sites`;
const toDto = (s) => ({
  id: s.id,
  name: s.name,
  address: s.address,
  latitude: s.latitude,
  longitude: s.longitude,
  radiusM: s.radiusM,
  isActive: s.isActive === 1,
});

// Semua user boleh melihat lokasi aktif; pengelola lokasi dapat melihat semua (?all=1).
router.get('/', async (req, res) => {
  const all = req.query.all === '1' && can(req.user.roleCode, 'manageSites');
  const list = await db.rows(`${SELECT} ${all ? '' : 'WHERE is_active = 1'} ORDER BY name`);
  res.json({ sites: list.map(toDto) });
});

const siteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: optionalText(255),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusM: z.number().int().min(10).max(50000).default(100),
  isActive: z.boolean().default(true),
});

router.post('/', requirePermission('manageSites'), async (req, res) => {
  const d = siteSchema.parse(req.body);
  const r = await db.query(
    `INSERT INTO sites (name, address, latitude, longitude, radius_m, is_active)
     VALUES (:name, :address, :lat, :lng, :radius, :active)
     RETURNING id INTO :newId`,
    {
      name: d.name, address: d.address ?? null, lat: d.latitude, lng: d.longitude,
      radius: d.radiusM, active: d.isActive ? 1 : 0,
      newId: { dir: db.oracledb.BIND_OUT, type: db.oracledb.NUMBER },
    },
  );
  const newId = r.outBinds.newId[0];
  await audit(req.user.id, 'SITE_CREATE', `id=${newId} ${d.name}`, req.ip);
  res.status(201).json({ site: toDto(await db.one(`${SELECT} WHERE id = :id`, { id: newId })) });
});

router.put('/:id', requirePermission('manageSites'), async (req, res) => {
  const siteId = id.parse(req.params.id);
  const d = siteSchema.partial().parse(req.body);
  const exists = await db.one('SELECT id FROM sites WHERE id = :id', { id: siteId });
  if (!exists) throw notFound('Lokasi tidak ditemukan');

  const map = {
    name: 'name', address: 'address', latitude: 'latitude',
    longitude: 'longitude', radiusM: 'radius_m', isActive: 'is_active',
  };
  const sets = ['updated_at = SYSTIMESTAMP'];
  const binds = { id: siteId };
  for (const [key, col] of Object.entries(map)) {
    if (d[key] !== undefined) {
      sets.push(`${col} = :${key}`);
      binds[key] = key === 'isActive' ? (d[key] ? 1 : 0) : d[key];
    }
  }
  await db.query(`UPDATE sites SET ${sets.join(', ')} WHERE id = :id`, binds);
  await audit(req.user.id, 'SITE_UPDATE', `id=${siteId} ${JSON.stringify(d)}`, req.ip);
  res.json({ site: toDto(await db.one(`${SELECT} WHERE id = :id`, { id: siteId })) });
});

module.exports = router;
