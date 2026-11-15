'use strict';
const express = require('express');
const db = require('../db');
const { z, optionalText, id } = require('../validation');
const { authenticate, requirePermission } = require('../middleware/auth');
const { can, siteScope } = require('../roles');
const { evaluate, projectRequest, r3 } = require('../utils/materialStatus');
const { localDate, isValidDateStr } = require('../utils/time');
const { badRequest, forbidden, notFound, conflict, unprocessable } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { loadPlan, assertSiteAccess, PLAN_SELECT } = require('./materials');

const router = express.Router();
router.use(authenticate, requirePermission('viewMaterials'));

const STATUS_LABEL = {
  PENDING: 'Menunggu persetujuan',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
  ORDERED: 'Sudah dipesan',
  PARTIAL: 'Diterima sebagian',
  RECEIVED: 'Diterima lengkap',
  CANCELLED: 'Dibatalkan',
};

const dateStr = z.string().refine(isValidDateStr, 'Format tanggal harus YYYY-MM-DD');

const HEADER_SELECT = `
  SELECT pr.id, pr.request_no, pr.site_id, s.name AS site_name, pr.status,
         TO_CHAR(pr.needed_date, 'YYYY-MM-DD') AS needed_date, pr.note,
         pr.requested_by, ru.full_name AS requested_by_name, pr.requested_at,
         pr.decided_by, du.full_name AS decided_by_name, pr.decided_at, pr.decision_note,
         pr.supplier, pr.po_number, TO_CHAR(pr.order_date, 'YYYY-MM-DD') AS order_date,
         TO_CHAR(pr.expected_date, 'YYYY-MM-DD') AS expected_date,
         ou.full_name AS ordered_by_name, pr.ordered_at,
         (SELECT COUNT(*) FROM purchase_request_items i WHERE i.request_id = pr.id) AS item_count,
         (SELECT SUM(i.qty * i.unit_price) FROM purchase_request_items i WHERE i.request_id = pr.id) AS total_value
    FROM purchase_requests pr
    JOIN sites s ON s.id = pr.site_id
    JOIN users ru ON ru.id = pr.requested_by
    LEFT JOIN users du ON du.id = pr.decided_by
    LEFT JOIN users ou ON ou.id = pr.ordered_by`;

const headerDto = (h) => ({ ...h, statusLabel: STATUS_LABEL[h.status], totalValue: h.totalValue ?? null });

async function loadRequest(prId, conn) {
  const sql = `${HEADER_SELECT} WHERE pr.id = :id`;
  const h = conn ? (await db.x(conn, sql, { id: prId })).rows[0] : await db.one(sql, { id: prId });
  if (!h) throw notFound('Permintaan pembelian tidak ditemukan');
  const itemsSql = `
    SELECT i.id, i.site_material_id, i.qty, i.qty_received, i.unit_price, i.note,
           m.code, m.name, m.unit
      FROM purchase_request_items i
      JOIN site_materials sm ON sm.id = i.site_material_id
      JOIN materials m ON m.id = sm.material_id
     WHERE i.request_id = :id ORDER BY i.id`;
  const items = conn ? (await db.x(conn, itemsSql, { id: prId })).rows : await db.rows(itemsSql, { id: prId });
  return { header: h, items };
}

/** Lengkapi item dengan status material saat ini + proyeksi bila PR ini disetujui. */
async function withProjection(req, conn) {
  const out = [];
  for (const it of req.items) {
    const plan = await loadPlan(it.siteMaterialId, conn);
    const status = evaluate(plan);
    const item = {
      ...it,
      qty: r3(it.qty),
      qtyReceived: r3(it.qtyReceived),
      remaining: r3(it.qty - it.qtyReceived),
      material: { plannedQty: r3(plan.plannedQty), stock: status.stock, procured: status.procured,
        procuredPct: status.procuredPct, level: status.level, flags: status.flags },
    };
    if (req.header.status === 'PENDING') {
      // "pending" di plan sudah mencakup PR ini; proyeksi = diterima + dipesan + qty PR ini.
      item.projection = projectRequest(plan, it.qty);
    }
    out.push(item);
  }
  return out;
}

router.get('/', async (req, res) => {
  const q = z.object({
    status: z.enum(Object.keys(STATUS_LABEL)).optional(),
    siteId: id.optional(),
  }).parse(req.query);
  const where = [];
  const binds = {};
  const scope = siteScope(req.user);
  const siteId = scope || q.siteId;
  if (siteId) { where.push('pr.site_id = :siteId'); binds.siteId = siteId; }
  if (q.status) { where.push('pr.status = :status'); binds.status = q.status; }
  const list = await db.rows(
    `${HEADER_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY CASE pr.status WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 WHEN 'ORDERED' THEN 2
                             WHEN 'PARTIAL' THEN 3 ELSE 4 END, pr.requested_at DESC
     FETCH FIRST 500 ROWS ONLY`,
    binds,
  );
  res.json({ requests: list.map(headerDto) });
});

router.get('/:id', async (req, res) => {
  const pr = await loadRequest(id.parse(req.params.id));
  assertSiteAccess(req.user, pr.header.siteId);
  const items = await withProjection(pr);
  const u = req.user;
  const h = pr.header;
  res.json({
    request: headerDto(h),
    items,
    actions: {
      approve: h.status === 'PENDING' && can(u.roleCode, 'approvePurchase') && h.requestedBy !== u.id,
      reject: h.status === 'PENDING' && can(u.roleCode, 'approvePurchase') && h.requestedBy !== u.id,
      cancel: ['PENDING', 'APPROVED'].includes(h.status) && (h.requestedBy === u.id || u.roleCode === 'SUPERADMIN'),
      order: h.status === 'APPROVED' && can(u.roleCode, 'handleStock'),
      receive: ['ORDERED', 'PARTIAL'].includes(h.status) && can(u.roleCode, 'handleStock'),
    },
  });
});

const createSchema = z.object({
  siteId: id,
  neededDate: dateStr.optional(),
  note: optionalText(500),
  items: z.array(z.object({
    siteMaterialId: id,
    qty: z.number().positive().max(1e10),
    unitPrice: z.number().min(0).max(1e13).optional(),
    note: optionalText(255),
  })).min(1, 'Minimal satu material').max(100),
});

router.post('/', requirePermission('requestPurchase'), async (req, res) => {
  const d = createSchema.parse(req.body);
  assertSiteAccess(req.user, d.siteId);
  const ids = d.items.map((i) => i.siteMaterialId);
  if (new Set(ids).size !== ids.length) throw badRequest('Material yang sama tidak boleh muncul dua kali');

  const prId = await db.withConnection(async (conn) => {
    for (const it of d.items) {
      const plan = (await db.x(conn, 'SELECT site_id FROM site_materials WHERE id = :id', { id: it.siteMaterialId })).rows[0];
      if (!plan) throw badRequest(`Material (id ${it.siteMaterialId}) belum ada di daftar kebutuhan`);
      if (plan.siteId !== d.siteId) throw badRequest('Semua material harus dari lokasi yang sama');
    }
    const r = await db.x(conn,
      `INSERT INTO purchase_requests (request_no, site_id, needed_date, note, requested_by)
       VALUES (:tmp, :siteId, TO_DATE(:needed, 'YYYY-MM-DD'), :note, :actorId) RETURNING id INTO :newId`,
      { tmp: `TMP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, siteId: d.siteId,
        needed: d.neededDate ?? null, note: d.note ?? null, actorId: req.user.id,
        newId: { dir: db.oracledb.BIND_OUT, type: db.oracledb.NUMBER } });
    const newId = r.outBinds.newId[0];
    const no = `PR-${localDate().replace(/-/g, '')}-${String(newId).padStart(4, '0')}`;
    await db.x(conn, 'UPDATE purchase_requests SET request_no = :no WHERE id = :id', { no, id: newId });
    for (const it of d.items) {
      await db.x(conn,
        `INSERT INTO purchase_request_items (request_id, site_material_id, qty, unit_price, note)
         VALUES (:pr, :sm, :qty, :price, :note)`,
        { pr: newId, sm: it.siteMaterialId, qty: it.qty, price: it.unitPrice ?? null, note: it.note ?? null });
    }
    return newId;
  });
  await audit(req.user.id, 'PR_CREATE', `id=${prId} items=${d.items.length}`, req.ip);
  const pr = await loadRequest(prId);
  res.status(201).json({ request: headerDto(pr.header), items: await withProjection(pr) });
});

/** Ubah status secara atomik: hanya berhasil bila status saat ini sesuai harapan. */
async function transition(conn, prId, fromStatuses, sets, binds) {
  const r = await db.x(conn,
    `UPDATE purchase_requests SET ${sets} WHERE id = :id AND status IN (${fromStatuses.map((s) => `'${s}'`).join(',')})`,
    { id: prId, ...binds });
  if (r.rowsAffected !== 1) throw conflict('Status permintaan sudah berubah. Muat ulang data.');
}

const decisionSchema = z.object({ note: optionalText(500) });

router.post('/:id/approve', requirePermission('approvePurchase'), async (req, res) => {
  const prId = id.parse(req.params.id);
  const { note } = decisionSchema.parse(req.body || {});
  await db.withConnection(async (conn) => {
    const pr = await loadRequest(prId, conn);
    assertSiteAccess(req.user, pr.header.siteId);
    if (pr.header.requestedBy === req.user.id) throw forbidden('Anda tidak dapat menyetujui permintaan Anda sendiri');
    await transition(conn, prId, ['PENDING'],
      "status = 'APPROVED', decided_by = :actorId, decided_at = SYSTIMESTAMP, decision_note = :note",
      { actorId: req.user.id, note: note ?? null });
  });
  await audit(req.user.id, 'PR_APPROVE', `id=${prId}`, req.ip);
  res.json({ message: 'Permintaan pembelian disetujui' });
});

router.post('/:id/reject', requirePermission('approvePurchase'), async (req, res) => {
  const prId = id.parse(req.params.id);
  const { note } = decisionSchema.parse(req.body || {});
  if (!note) throw badRequest('Alasan penolakan wajib diisi');
  await db.withConnection(async (conn) => {
    const pr = await loadRequest(prId, conn);
    assertSiteAccess(req.user, pr.header.siteId);
    if (pr.header.requestedBy === req.user.id) throw forbidden('Anda tidak dapat memutuskan permintaan Anda sendiri');
    await transition(conn, prId, ['PENDING'],
      "status = 'REJECTED', decided_by = :actorId, decided_at = SYSTIMESTAMP, decision_note = :note",
      { actorId: req.user.id, note });
  });
  await audit(req.user.id, 'PR_REJECT', `id=${prId} ${note}`, req.ip);
  res.json({ message: 'Permintaan pembelian ditolak' });
});

router.post('/:id/cancel', async (req, res) => {
  const prId = id.parse(req.params.id);
  await db.withConnection(async (conn) => {
    const pr = await loadRequest(prId, conn);
    if (pr.header.requestedBy !== req.user.id && req.user.roleCode !== 'SUPERADMIN') {
      throw forbidden('Hanya pembuat permintaan yang dapat membatalkan');
    }
    await transition(conn, prId, ['PENDING', 'APPROVED'], "status = 'CANCELLED'", {});
  });
  await audit(req.user.id, 'PR_CANCEL', `id=${prId}`, req.ip);
  res.json({ message: 'Permintaan pembelian dibatalkan' });
});

const orderSchema = z.object({
  supplier: z.string().trim().min(1, 'Supplier wajib diisi').max(150),
  poNumber: optionalText(60),
  orderDate: dateStr.optional(),
  expectedDate: dateStr.optional(),
  prices: z.array(z.object({ itemId: id, unitPrice: z.number().min(0).max(1e13) })).max(100).optional(),
});

router.post('/:id/order', requirePermission('handleStock'), async (req, res) => {
  const prId = id.parse(req.params.id);
  const d = orderSchema.parse(req.body);
  await db.withConnection(async (conn) => {
    const pr = await loadRequest(prId, conn);
    assertSiteAccess(req.user, pr.header.siteId);
    await transition(conn, prId, ['APPROVED'],
      `status = 'ORDERED', supplier = :supplier, po_number = :po,
       order_date = TO_DATE(:od, 'YYYY-MM-DD'), expected_date = TO_DATE(:ed, 'YYYY-MM-DD'),
       ordered_by = :actorId, ordered_at = SYSTIMESTAMP`,
      { supplier: d.supplier, po: d.poNumber ?? null, od: d.orderDate || localDate(),
        ed: d.expectedDate ?? null, actorId: req.user.id });
    const itemIds = new Set(pr.items.map((i) => i.id));
    for (const p of d.prices || []) {
      if (!itemIds.has(p.itemId)) throw badRequest('Item tidak termasuk dalam permintaan ini');
      await db.x(conn, 'UPDATE purchase_request_items SET unit_price = :p WHERE id = :id',
        { p: p.unitPrice, id: p.itemId });
    }
  });
  await audit(req.user.id, 'PR_ORDER', `id=${prId} supplier=${d.supplier}`, req.ip);
  res.json({ message: 'Pemesanan dicatat' });
});

const receiveSchema = z.object({
  date: dateStr.optional(),
  reference: optionalText(100),
  note: optionalText(500),
  items: z.array(z.object({ itemId: id, qty: z.number().positive().max(1e10) })).min(1).max(100),
});

router.post('/:id/receive', requirePermission('handleStock'), async (req, res) => {
  const prId = id.parse(req.params.id);
  const d = receiveSchema.parse(req.body);
  const date = d.date || localDate();
  if (date > localDate()) throw badRequest('Tanggal penerimaan tidak boleh di masa depan');

  const status = await db.withConnection(async (conn) => {
    // Kunci header agar dua penerimaan bersamaan tidak melebihi jumlah pesanan.
    const locked = await db.x(conn, 'SELECT status FROM purchase_requests WHERE id = :id FOR UPDATE', { id: prId });
    if (!locked.rows[0]) throw notFound('Permintaan pembelian tidak ditemukan');
    if (!['ORDERED', 'PARTIAL'].includes(locked.rows[0].status)) {
      throw conflict('Penerimaan hanya untuk permintaan yang sudah dipesan');
    }
    const pr = await loadRequest(prId, conn);
    assertSiteAccess(req.user, pr.header.siteId);
    const byId = new Map(pr.items.map((i) => [i.id, i]));
    for (const r of d.items) {
      const it = byId.get(r.itemId);
      if (!it) throw badRequest('Item tidak termasuk dalam permintaan ini');
      const remaining = r3(it.qty - it.qtyReceived);
      if (r.qty > remaining) {
        throw unprocessable(`${it.name}: jumlah diterima (${r.qty}) melebihi sisa pesanan (${remaining} ${it.unit})`);
      }
      await db.x(conn, 'UPDATE purchase_request_items SET qty_received = qty_received + :q WHERE id = :id',
        { q: r.qty, id: r.itemId });
      await db.x(conn,
        `INSERT INTO stock_movements (site_material_id, movement_type, qty, movement_date, pr_item_id, reference, note, created_by)
         VALUES (:sm, 'IN', :q, TO_DATE(:d, 'YYYY-MM-DD'), :pri, :ref, :note, :actorId)`,
        { sm: it.siteMaterialId, q: r.qty, d: date, pri: r.itemId,
          ref: d.reference ?? pr.header.poNumber ?? pr.header.requestNo, note: d.note ?? null, actorId: req.user.id });
    }
    const left = await db.x(conn,
      'SELECT COUNT(*) AS n FROM purchase_request_items WHERE request_id = :id AND qty_received < qty', { id: prId });
    const next = left.rows[0].n === 0 ? 'RECEIVED' : 'PARTIAL';
    await db.x(conn, 'UPDATE purchase_requests SET status = :s WHERE id = :id', { s: next, id: prId });
    return next;
  });
  await audit(req.user.id, 'PR_RECEIVE', `id=${prId} ${JSON.stringify(d.items)}`, req.ip);
  res.json({ message: status === 'RECEIVED' ? 'Semua barang sudah diterima' : 'Penerimaan sebagian dicatat', status });
});

module.exports = router;
module.exports.PLAN_SELECT = PLAN_SELECT;
