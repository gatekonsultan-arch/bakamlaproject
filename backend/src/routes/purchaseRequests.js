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
const files = require('../utils/files');
const { buildSubmissionHtml } = require('../reports/materialSubmissionPrint');

const router = express.Router();

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

// ------------------------------------------------------------------ cetak formulir (token bertanda tangan)
// GET /api/purchase-requests/:id/print?t=...  -> Material Purchase Submission & Approval Form
router.get('/:id/print', async (req, res) => {
  const prId = id.parse(req.params.id);
  const p = files.verify(req.query.t, 'msa');
  if (p.r !== prId) throw forbidden();
  const pr = await loadRequest(prId);
  const { loadLogos } = require('../reports/kop');
  const nonce = require('crypto').randomBytes(16).toString('base64');
  res.setHeader('Content-Security-Policy',
    `default-src 'none'; img-src 'self' data:; style-src 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(buildSubmissionHtml({
    header: pr.header,
    items: pr.items.map((i) => ({ ...i, photoUrl: files.signFile('hse', i.photoFile) })),
    logos: await loadLogos(pr.header.siteId),
    signatures: {
      submitted: files.signFile('signatures', pr.header.requestedSig),
      approved: files.signFile('signatures', pr.header.decidedSig),
    },
    nonce,
  }));
});

router.use(authenticate, requirePermission('viewMaterials'));

const HEADER_SELECT = `
  SELECT pr.id, pr.request_no, pr.site_id, s.name AS site_name, pr.status,
         TO_CHAR(pr.needed_date, 'YYYY-MM-DD') AS needed_date, pr.note,
         pr.requested_by, ru.full_name AS requested_by_name, pr.requested_at,
         pr.decided_by, du.full_name AS decided_by_name, pr.decided_at, pr.decision_note,
         pr.supplier, pr.po_number, TO_CHAR(pr.order_date, 'YYYY-MM-DD') AS order_date,
         TO_CHAR(pr.expected_date, 'YYYY-MM-DD') AS expected_date,
         ou.full_name AS ordered_by_name, pr.ordered_at, pr.category, pr.requested_sig, pr.decided_sig,
         (SELECT COUNT(*) FROM purchase_request_items i WHERE i.request_id = pr.id) AS item_count,
         (SELECT COUNT(*) FROM purchase_request_items i WHERE i.request_id = pr.id AND i.item_status = 'REJECTED') AS rejected_count,
         (SELECT SUM(i.qty * i.unit_price) FROM purchase_request_items i
           WHERE i.request_id = pr.id AND i.item_status <> 'REJECTED') AS total_value
    FROM purchase_requests pr
    JOIN sites s ON s.id = pr.site_id
    JOIN users ru ON ru.id = pr.requested_by
    LEFT JOIN users du ON du.id = pr.decided_by
    LEFT JOIN users ou ON ou.id = pr.ordered_by`;

const headerDto = (h) => {
  const { requestedSig, decidedSig, ...rest } = h;
  return { ...rest, statusLabel: STATUS_LABEL[h.status], totalValue: h.totalValue ?? null };
};
const ITEM_STATUS_LABEL = { PENDING: 'Menunggu', APPROVED: 'Disetujui', REJECTED: 'Ditolak' };

async function loadRequest(prId, conn) {
  const sql = `${HEADER_SELECT} WHERE pr.id = :id`;
  const h = conn ? (await db.x(conn, sql, { id: prId })).rows[0] : await db.one(sql, { id: prId });
  if (!h) throw notFound('Permintaan pembelian tidak ditemukan');
  const itemsSql = `
    SELECT i.id, i.site_material_id, i.qty, i.qty_received, i.unit_price, i.note,
           i.brand, i.spec, i.photo_file, i.item_status, i.decision_note,
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
    const { photoFile, ...rest } = it;
    const item = {
      ...rest,
      photoUrl: files.signFile('hse', photoFile),
      itemStatusLabel: ITEM_STATUS_LABEL[it.itemStatus],
      qty: r3(it.qty),
      qtyReceived: r3(it.qtyReceived),
      remaining: r3(it.qty - it.qtyReceived),
      material: { plannedQty: r3(plan.plannedQty), stock: status.stock, procured: status.procured,
        procuredPct: status.procuredPct, level: status.level, flags: status.flags },
    };
    if (req.header.status === 'PENDING' && it.itemStatus === 'PENDING') {
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
      decide: h.status === 'PENDING' && can(u.roleCode, 'approvePurchase') && h.requestedBy !== u.id,
      uploadPhoto: h.status === 'PENDING' && (h.requestedBy === u.id || u.roleCode === 'SUPERADMIN'),
      print: true,
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
  category: optionalText(100),
  items: z.array(z.object({
    siteMaterialId: id,
    qty: z.number().positive().max(1e10),
    unitPrice: z.number().min(0).max(1e13).optional(),
    brand: optionalText(100),
    spec: optionalText(255),
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
    const sig = (await db.x(conn, 'SELECT signature_file FROM users WHERE id = :id', { id: req.user.id })).rows[0]?.signatureFile;
    const r = await db.x(conn,
      `INSERT INTO purchase_requests (request_no, site_id, needed_date, note, category, requested_by, requested_sig)
       VALUES (:tmp, :siteId, TO_DATE(:needed, 'YYYY-MM-DD'), :note, :cat, :actorId, :sig) RETURNING id INTO :newId`,
      { tmp: `TMP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, siteId: d.siteId,
        needed: d.neededDate ?? null, note: d.note ?? null, cat: d.category ?? null, actorId: req.user.id, sig: sig ?? null,
        newId: { dir: db.oracledb.BIND_OUT, type: db.oracledb.NUMBER } });
    const newId = r.outBinds.newId[0];
    const no = `PR-${localDate().replace(/-/g, '')}-${String(newId).padStart(4, '0')}`;
    await db.x(conn, 'UPDATE purchase_requests SET request_no = :no WHERE id = :id', { no, id: newId });
    for (const it of d.items) {
      await db.x(conn,
        `INSERT INTO purchase_request_items (request_id, site_material_id, qty, unit_price, brand, spec, note)
         VALUES (:pr, :sm, :qty, :price, :brand, :spec, :note)`,
        { pr: newId, sm: it.siteMaterialId, qty: it.qty, price: it.unitPrice ?? null,
          brand: it.brand ?? null, spec: it.spec ?? null, note: it.note ?? null });
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

async function approverSignature(user, conn) {
  const u = (await db.x(conn, 'SELECT signature_file FROM users WHERE id = :id', { id: user.id })).rows[0];
  if (!u?.signatureFile) {
    throw unprocessable('Anda belum mengunggah tanda tangan digital. Unggah tanda tangan di menu Profil terlebih dahulu.',
      { code: 'SIGNATURE_REQUIRED' });
  }
  return u.signatureFile;
}

/**
 * Keputusan PM PER ITEM (Material Purchase Submission & Approval).
 * Item ditolak wajib diberi alasan. Permintaan menjadi APPROVED bila ada item yang disetujui
 * (hanya item itu yang boleh dipesan/diterima), atau REJECTED bila semua item ditolak.
 */
async function decide(req, prId, decisions, note) {
  return db.withConnection(async (conn) => {
    const pr = await loadRequest(prId, conn);
    assertSiteAccess(req.user, pr.header.siteId);
    if (pr.header.requestedBy === req.user.id) throw forbidden('Anda tidak dapat memutuskan permintaan Anda sendiri');
    if (pr.header.status !== 'PENDING') throw conflict('Status permintaan sudah berubah. Muat ulang data.');
    const byId = new Map(decisions.map((x) => [x.itemId, x]));
    for (const it of pr.items) {
      const dcs = byId.get(it.id);
      if (!dcs) throw badRequest(`Keputusan untuk ${it.name} belum diisi`);
      if (dcs.decision === 'REJECT' && !dcs.note) throw badRequest(`Alasan penolakan ${it.name} wajib diisi`);
    }
    if (decisions.some((x) => !pr.items.some((i) => i.id === x.itemId))) throw badRequest('Item tidak termasuk dalam permintaan ini');
    const sig = await approverSignature(req.user, conn);
    for (const it of pr.items) {
      const dcs = byId.get(it.id);
      await db.x(conn, 'UPDATE purchase_request_items SET item_status = :st, decision_note = :n WHERE id = :id',
        { st: dcs.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', n: dcs.note ?? null, id: it.id });
    }
    const approved = decisions.filter((x) => x.decision === 'APPROVE').length;
    await transition(conn, prId, ['PENDING'],
      `status = :st, decided_by = :actorId, decided_at = SYSTIMESTAMP, decision_note = :note, decided_sig = :sig`,
      { st: approved ? 'APPROVED' : 'REJECTED', actorId: req.user.id, note: note ?? null, sig });
    return { approved, rejected: decisions.length - approved };
  });
}

const decideSchema = z.object({
  note: optionalText(500),
  items: z.array(z.object({
    itemId: id,
    decision: z.enum(['APPROVE', 'REJECT']),
    note: optionalText(500),
  })).min(1).max(100),
});

router.post('/:id/decide', requirePermission('approvePurchase'), async (req, res) => {
  const prId = id.parse(req.params.id);
  const d = decideSchema.parse(req.body);
  const r = await decide(req, prId, d.items, d.note);
  await audit(req.user.id, 'PR_DECIDE', `id=${prId} approved=${r.approved} rejected=${r.rejected}`, req.ip);
  res.json({
    message: r.approved
      ? `${r.approved} item disetujui${r.rejected ? `, ${r.rejected} item ditolak` : ''}`
      : 'Semua item ditolak',
    ...r,
  });
});

// Setujui semua item sekaligus
router.post('/:id/approve', requirePermission('approvePurchase'), async (req, res) => {
  const prId = id.parse(req.params.id);
  const { note } = decisionSchema.parse(req.body || {});
  const pr = await loadRequest(prId);
  await decide(req, prId, pr.items.map((i) => ({ itemId: i.id, decision: 'APPROVE' })), note);
  await audit(req.user.id, 'PR_APPROVE', `id=${prId}`, req.ip);
  res.json({ message: 'Permintaan pembelian disetujui' });
});

// Tolak semua item sekaligus
router.post('/:id/reject', requirePermission('approvePurchase'), async (req, res) => {
  const prId = id.parse(req.params.id);
  const { note } = decisionSchema.parse(req.body || {});
  if (!note) throw badRequest('Alasan penolakan wajib diisi');
  const pr = await loadRequest(prId);
  await decide(req, prId, pr.items.map((i) => ({ itemId: i.id, decision: 'REJECT', note })), note);
  await audit(req.user.id, 'PR_REJECT', `id=${prId} ${note}`, req.ip);
  res.json({ message: 'Permintaan pembelian ditolak' });
});

// Foto material (label merek/tipe terlihat) per item, oleh pengaju selama menunggu persetujuan
router.post('/:id/items/:itemId/photo', requirePermission('requestPurchase'), files.upload.single('photo'), async (req, res) => {
  const prId = id.parse(req.params.id);
  const itemId = id.parse(req.params.itemId);
  if (!req.file) throw badRequest('Foto wajib diunggah');
  const pr = await loadRequest(prId);
  assertSiteAccess(req.user, pr.header.siteId);
  if (pr.header.status !== 'PENDING') throw conflict('Foto hanya bisa diubah selama menunggu persetujuan');
  if (pr.header.requestedBy !== req.user.id && req.user.roleCode !== 'SUPERADMIN') throw forbidden('Hanya pengaju yang dapat mengunggah foto');
  const it = pr.items.find((i) => i.id === itemId);
  if (!it) throw notFound('Item tidak ditemukan');
  const name = await files.saveImage('hse', req.file.buffer);
  await db.query('UPDATE purchase_request_items SET photo_file = :f WHERE id = :id', { f: name, id: itemId });
  if (it.photoFile) await files.removeFile('hse', it.photoFile);
  res.json({ photoUrl: files.signFile('hse', name) });
});

router.post('/:id/print-link', async (req, res) => {
  const prId = id.parse(req.params.id);
  const pr = await loadRequest(prId);
  assertSiteAccess(req.user, pr.header.siteId);
  const jwt = require('jsonwebtoken');
  const t = jwt.sign({ p: 'msa', r: prId }, require('../config').jwt.secret, { expiresIn: '15m', algorithm: 'HS256' });
  res.json({ url: `/api/purchase-requests/${prId}/print?t=${encodeURIComponent(t)}` });
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
    const itemIds = new Set(pr.items.filter((i) => i.itemStatus === 'APPROVED').map((i) => i.id));
    for (const p of d.prices || []) {
      if (!itemIds.has(p.itemId)) throw badRequest('Item tidak termasuk dalam permintaan ini atau tidak disetujui');
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
      if (it.itemStatus !== 'APPROVED') throw unprocessable(`${it.name} ditolak PM dan tidak boleh diterima`);
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
      `SELECT COUNT(*) AS n FROM purchase_request_items
        WHERE request_id = :id AND item_status = 'APPROVED' AND qty_received < qty`, { id: prId });
    const next = left.rows[0].n === 0 ? 'RECEIVED' : 'PARTIAL';
    await db.x(conn, 'UPDATE purchase_requests SET status = :s WHERE id = :id', { s: next, id: prId });
    return next;
  });
  await audit(req.user.id, 'PR_RECEIVE', `id=${prId} ${JSON.stringify(d.items)}`, req.ip);
  res.json({ message: status === 'RECEIVED' ? 'Semua barang sudah diterima' : 'Penerimaan sebagian dicatat', status });
});

module.exports = router;
module.exports.PLAN_SELECT = PLAN_SELECT;
