'use strict';
const express = require('express');
const db = require('../db');
const { z, optionalText, id } = require('../validation');
const { authenticate, requirePermission } = require('../middleware/auth');
const { can, siteScope, ROLES } = require('../roles');
const { evaluate, r3 } = require('../utils/materialStatus');
const { localDate, isValidDateStr } = require('../utils/time');
const { badRequest, forbidden, notFound, conflict, unprocessable, isUniqueViolation } = require('../utils/errors');
const { audit } = require('../utils/audit');

const router = express.Router();
router.use(authenticate, requirePermission('viewMaterials'));

/** Pastikan user boleh mengakses site ini. */
function assertSiteAccess(user, siteId) {
  const scope = siteScope(user);
  if (scope && scope !== siteId) throw forbidden('Anda hanya dapat mengakses lokasi kerja Anda sendiri');
}

// ---------------------------------------------------------------- Katalog material
router.get('/catalog', async (_req, res) => {
  const list = await db.rows(
    'SELECT id, code, name, unit, category, is_active FROM materials ORDER BY name',
  );
  res.json({ materials: list.map((m) => ({ ...m, isActive: m.isActive === 1 })) });
});

const catalogSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(40).regex(/^[A-Z0-9._-]+$/, 'Kode hanya huruf, angka, titik, minus'),
  name: z.string().trim().min(1).max(150),
  unit: z.string().trim().min(1).max(20),
  category: optionalText(60),
  isActive: z.boolean().optional(),
});

router.post('/catalog', requirePermission('planMaterials'), async (req, res) => {
  const d = catalogSchema.parse(req.body);
  try {
    const r = await db.query(
      `INSERT INTO materials (code, name, unit, category) VALUES (:code, :name, :unit, :category)
       RETURNING id INTO :newId`,
      { code: d.code, name: d.name, unit: d.unit, category: d.category ?? null,
        newId: { dir: db.oracledb.BIND_OUT, type: db.oracledb.NUMBER } },
    );
    await audit(req.user.id, 'MATERIAL_CREATE', `${d.code} ${d.name}`, req.ip);
    res.status(201).json({ material: { id: r.outBinds.newId[0], ...d, isActive: true } });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('Kode material sudah digunakan');
    throw err;
  }
});

router.put('/catalog/:id', requirePermission('planMaterials'), async (req, res) => {
  const mid = id.parse(req.params.id);
  const d = catalogSchema.partial().parse(req.body);
  const cols = { code: 'code', name: 'name', unit: 'unit', category: 'category', isActive: 'is_active' };
  const sets = [];
  const binds = { id: mid };
  for (const [k, col] of Object.entries(cols)) {
    if (d[k] !== undefined) { sets.push(`${col} = :${k}`); binds[k] = k === 'isActive' ? (d[k] ? 1 : 0) : d[k]; }
  }
  if (!sets.length) throw badRequest('Tidak ada perubahan');
  try {
    const r = await db.query(`UPDATE materials SET ${sets.join(', ')} WHERE id = :id`, binds);
    if (r.rowsAffected !== 1) throw notFound('Material tidak ditemukan');
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('Kode material sudah digunakan');
    throw err;
  }
  await audit(req.user.id, 'MATERIAL_UPDATE', `id=${mid} ${JSON.stringify(d)}`, req.ip);
  res.json({ message: 'Material diperbarui' });
});

// ---------------------------------------------------------------- Kebutuhan per lokasi + status
const PLAN_SELECT = `
  SELECT sm.id, sm.site_id, s.name AS site_name, m.id AS material_id, m.code, m.name, m.unit,
         m.category, sm.planned_qty, sm.min_stock, sm.warn_pct, sm.notes, sm.updated_at,
         NVL(mv.qty_in, 0) AS received, NVL(mv.qty_out, 0) AS used, NVL(mv.qty_adj, 0) AS adjusted,
         NVL(po.on_order, 0) AS on_order, NVL(po.pending, 0) AS pending
    FROM site_materials sm
    JOIN materials m ON m.id = sm.material_id
    JOIN sites s ON s.id = sm.site_id
    LEFT JOIN (SELECT site_material_id,
                      SUM(CASE WHEN movement_type = 'IN'  THEN qty ELSE 0 END) AS qty_in,
                      SUM(CASE WHEN movement_type = 'OUT' THEN qty ELSE 0 END) AS qty_out,
                      SUM(CASE WHEN movement_type = 'ADJ' THEN qty ELSE 0 END) AS qty_adj
                 FROM stock_movements GROUP BY site_material_id) mv ON mv.site_material_id = sm.id
    LEFT JOIN (SELECT i.site_material_id,
                      SUM(CASE WHEN pr.status IN ('APPROVED','ORDERED','PARTIAL') AND i.item_status = 'APPROVED'
                               THEN i.qty - i.qty_received ELSE 0 END) AS on_order,
                      SUM(CASE WHEN pr.status = 'PENDING' AND i.item_status = 'PENDING' THEN i.qty ELSE 0 END) AS pending
                 FROM purchase_request_items i
                 JOIN purchase_requests pr ON pr.id = i.request_id
                GROUP BY i.site_material_id) po ON po.site_material_id = sm.id`;

function planDto(row) {
  return {
    id: row.id,
    siteId: row.siteId,
    siteName: row.siteName,
    materialId: row.materialId,
    code: row.code,
    name: row.name,
    unit: row.unit,
    category: row.category,
    plannedQty: r3(row.plannedQty),
    minStock: r3(row.minStock),
    warnPct: row.warnPct,
    notes: row.notes,
    ...evaluate(row),
  };
}

async function loadPlan(planId, conn) {
  const sql = `${PLAN_SELECT} WHERE sm.id = :id`;
  const row = conn ? (await db.x(conn, sql, { id: planId })).rows[0] : await db.one(sql, { id: planId });
  if (!row) throw notFound('Data kebutuhan material tidak ditemukan');
  return row;
}

router.get('/plans', async (req, res) => {
  const q = z.object({
    siteId: id.optional(),
    level: z.enum(['GREEN', 'YELLOW', 'RED']).optional(),
    search: z.string().trim().max(50).optional(),
  }).parse(req.query);

  const where = [];
  const binds = {};
  const scope = siteScope(req.user);
  const siteId = scope || q.siteId;
  if (siteId) { where.push('sm.site_id = :siteId'); binds.siteId = siteId; }
  if (q.search) {
    where.push('(LOWER(m.name) LIKE :s OR LOWER(m.code) LIKE :s)');
    binds.s = `%${q.search.toLowerCase()}%`;
  }
  let list = (await db.rows(
    `${PLAN_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.name, m.name`,
    binds,
  )).map(planDto);
  if (q.level) list = list.filter((p) => p.level === q.level);

  const counts = { GREEN: 0, YELLOW: 0, RED: 0 };
  list.forEach((p) => { counts[p.level]++; });
  res.json({ plans: list, counts });
});

router.get('/plans/:id', async (req, res) => {
  const planId = id.parse(req.params.id);
  const row = await loadPlan(planId);
  assertSiteAccess(req.user, row.siteId);
  const movements = await db.rows(
    `SELECT mv.id, mv.movement_type, mv.qty, TO_CHAR(mv.movement_date, 'YYYY-MM-DD') AS movement_date,
            mv.reference, mv.note, u.full_name AS created_by_name, mv.created_at, pr.request_no
       FROM stock_movements mv
       JOIN users u ON u.id = mv.created_by
       LEFT JOIN purchase_request_items i ON i.id = mv.pr_item_id
       LEFT JOIN purchase_requests pr ON pr.id = i.request_id
      WHERE mv.site_material_id = :id
      ORDER BY mv.movement_date DESC, mv.id DESC FETCH FIRST 500 ROWS ONLY`,
    { id: planId },
  );
  res.json({ plan: planDto(row), movements });
});

const planSchema = z.object({
  siteId: id,
  materialId: id,
  plannedQty: z.number().positive().max(1e10),
  minStock: z.number().min(0).max(1e10).default(0),
  warnPct: z.number().int().min(1).max(99).default(80),
  notes: optionalText(500),
});

router.post('/plans', requirePermission('planMaterials'), async (req, res) => {
  const d = planSchema.parse(req.body);
  if (req.user.roleCode === ROLES.SITE_MANAGER) assertSiteAccess({ ...req.user, roleCode: ROLES.SITE_MANAGER }, d.siteId);
  try {
    const r = await db.query(
      `INSERT INTO site_materials (site_id, material_id, planned_qty, min_stock, warn_pct, notes, created_by, updated_by)
       VALUES (:siteId, :materialId, :planned, :minStock, :warnPct, :notes, :actorId, :actorId)
       RETURNING id INTO :newId`,
      { siteId: d.siteId, materialId: d.materialId, planned: d.plannedQty, minStock: d.minStock,
        warnPct: d.warnPct, notes: d.notes ?? null, actorId: req.user.id,
        newId: { dir: db.oracledb.BIND_OUT, type: db.oracledb.NUMBER } },
    );
    const newId = r.outBinds.newId[0];
    await audit(req.user.id, 'MATERIAL_PLAN_CREATE', `id=${newId} ${JSON.stringify(d)}`, req.ip);
    res.status(201).json({ plan: planDto(await loadPlan(newId)) });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('Material ini sudah ada di daftar kebutuhan lokasi tersebut');
    if (err.errorNum === 2291) throw badRequest('Lokasi atau material tidak ditemukan');
    throw err;
  }
});

const planUpdateSchema = z.object({
  plannedQty: z.number().positive().max(1e10).optional(),
  minStock: z.number().min(0).max(1e10).optional(),
  warnPct: z.number().int().min(1).max(99).optional(),
  notes: optionalText(500),
});

router.put('/plans/:id', requirePermission('planMaterials'), async (req, res) => {
  const planId = id.parse(req.params.id);
  const d = planUpdateSchema.parse(req.body);
  const row = await loadPlan(planId);
  if (req.user.roleCode === ROLES.SITE_MANAGER) assertSiteAccess(req.user, row.siteId);

  const cols = { plannedQty: 'planned_qty', minStock: 'min_stock', warnPct: 'warn_pct', notes: 'notes' };
  const sets = ['updated_at = SYSTIMESTAMP', 'updated_by = :actorId'];
  const binds = { id: planId, actorId: req.user.id };
  for (const [k, col] of Object.entries(cols)) {
    if (d[k] !== undefined) { sets.push(`${col} = :${k}`); binds[k] = d[k]; }
  }
  await db.query(`UPDATE site_materials SET ${sets.join(', ')} WHERE id = :id`, binds);
  await audit(req.user.id, 'MATERIAL_PLAN_UPDATE', `id=${planId} before=${r3(row.plannedQty)}/${r3(row.minStock)} ${JSON.stringify(d)}`, req.ip);
  res.json({ plan: planDto(await loadPlan(planId)) });
});

// ---------------------------------------------------------------- Pencatatan pemakaian / penyesuaian
const movementSchema = z.object({
  siteMaterialId: id,
  type: z.enum(['OUT', 'ADJ']),
  qty: z.number().refine((n) => n !== 0, 'Jumlah tidak boleh 0').refine((n) => Math.abs(n) <= 1e10),
  date: z.string().optional(),
  reference: optionalText(100),
  note: optionalText(500),
});

router.post('/movements', requirePermission('handleStock'), async (req, res) => {
  const d = movementSchema.parse(req.body);
  const date = d.date || localDate();
  if (!isValidDateStr(date)) throw badRequest('Format tanggal harus YYYY-MM-DD');
  if (date > localDate()) throw badRequest('Tanggal tidak boleh di masa depan');
  if (d.type === 'OUT' && d.qty <= 0) throw badRequest('Jumlah pemakaian harus lebih dari 0');
  if (d.type === 'ADJ' && !d.note) throw badRequest('Penyesuaian stok wajib diberi keterangan');

  const result = await db.withConnection(async (conn) => {
    // Kunci baris agar pengecekan stok aman dari input bersamaan.
    await db.x(conn, 'SELECT id FROM site_materials WHERE id = :id FOR UPDATE', { id: d.siteMaterialId });
    const row = await loadPlan(d.siteMaterialId, conn);
    assertSiteAccess(req.user, row.siteId);
    const before = evaluate(row);
    if (r3(before.stock - (d.type === 'OUT' ? d.qty : -d.qty)) < 0) {
      throw unprocessable(`Stok tidak cukup. Stok saat ini ${before.stock} ${row.unit}.`);
    }
    await db.x(conn,
      `INSERT INTO stock_movements (site_material_id, movement_type, qty, movement_date, reference, note, created_by)
       VALUES (:sm, :type, :qty, TO_DATE(:d, 'YYYY-MM-DD'), :ref, :note, :actorId)`,
      { sm: d.siteMaterialId, type: d.type, qty: d.qty, d: date, ref: d.reference ?? null,
        note: d.note ?? null, actorId: req.user.id });
    return planDto(await loadPlan(d.siteMaterialId, conn));
  });
  await audit(req.user.id, d.type === 'OUT' ? 'STOCK_OUT' : 'STOCK_ADJ', `sm=${d.siteMaterialId} qty=${d.qty}`, req.ip);
  res.status(201).json({
    message: d.type === 'OUT' ? 'Pemakaian material dicatat' : 'Penyesuaian stok dicatat',
    plan: result,
  });
});

// ---------------------------------------------------------------- Dashboard penanda
router.get('/alerts', async (req, res) => {
  const scope = siteScope(req.user);
  const list = (await db.rows(
    `${PLAN_SELECT} ${scope ? 'WHERE sm.site_id = :siteId' : ''} ORDER BY s.name, m.name`,
    scope ? { siteId: scope } : {},
  )).map(planDto);
  const alerts = list.filter((p) => p.level !== 'GREEN')
    .sort((a, b) => (a.level === b.level ? 0 : a.level === 'RED' ? -1 : 1));
  const pending = await db.one(
    `SELECT COUNT(*) AS n FROM purchase_requests WHERE status = 'PENDING' ${scope ? 'AND site_id = :siteId' : ''}`,
    scope ? { siteId: scope } : {},
  );
  res.json({
    counts: {
      RED: list.filter((p) => p.level === 'RED').length,
      YELLOW: list.filter((p) => p.level === 'YELLOW').length,
      GREEN: list.filter((p) => p.level === 'GREEN').length,
      pendingRequests: pending.n,
    },
    alerts,
    canApprove: can(req.user.roleCode, 'approvePurchase'),
  });
});

module.exports = router;
module.exports.PLAN_SELECT = PLAN_SELECT;
module.exports.loadPlan = loadPlan;
module.exports.assertSiteAccess = assertSiteAccess;
module.exports.planDto = planDto;
