'use strict';
/**
 * ATP Checklist (Acceptance Test Procedure) mutu pekerjaan struktur.
 * Alur: Site Manager menyusun (DRAFT) -> kirim (SUBMITTED) -> Project Manager menyetujui (APPROVED)
 *       atau mengembalikan (REVISION). Dokumen yang disetujui dicetak lalu ditandatangani basah
 *       oleh Inspektur/pengawas pemberi kerja pada kolom "APPROVED BY".
 */
const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db');
const config = require('../config');
const { z, optionalText, id } = require('../validation');
const { authenticate, requirePermission } = require('../middleware/auth');
const { can, siteScope } = require('../roles');
const { localDate, isValidDateStr } = require('../utils/time');
const { badRequest, forbidden, notFound, conflict, unprocessable } = require('../utils/errors');
const { audit } = require('../utils/audit');
const files = require('../utils/files');
const { suggestResult } = require('../utils/tolerance');
const lib = require('../reports/atpLibrary');
const { buildAtpHtml } = require('../reports/atpPrint');
const { loadSiteReport } = require('../reports/kop');

const router = express.Router();
const STATUS_LABEL = {
  DRAFT: 'Draf',
  SUBMITTED: 'Menunggu persetujuan PM',
  APPROVED: 'Disetujui PM (siap ditandatangani pengawas)',
  REVISION: 'Perlu revisi',
};
const dateStr = z.string().refine(isValidDateStr, 'Format tanggal YYYY-MM-DD');

function assertSite(user, siteId) {
  const scope = siteScope(user);
  if (scope && scope !== siteId) throw forbidden('Anda hanya dapat mengakses ATP lokasi kerja Anda');
}

const HEADER = `
  SELECT a.id, a.site_id, s.name AS site_name, a.doc_no, a.work_area,
         TO_CHAR(a.inspection_date, 'YYYY-MM-DD') AS inspection_date, a.status, a.notes,
         a.created_by, cu.full_name AS created_by_name, a.updated_at,
         a.submitted_by, su.full_name AS submitted_by_name, a.submitted_at, a.submitted_sig,
         a.approved_by, au.full_name AS approved_by_name, a.approved_at, a.approved_sig, a.revision_note
    FROM atp_documents a
    JOIN sites s ON s.id = a.site_id
    JOIN users cu ON cu.id = a.created_by
    LEFT JOIN users su ON su.id = a.submitted_by
    LEFT JOIN users au ON au.id = a.approved_by`;

async function loadAtp(atpId) {
  const h = await db.one(`${HEADER} WHERE a.id = :id`, { id: atpId });
  if (!h) throw notFound('Dokumen ATP tidak ditemukan');
  const items = await db.rows(
    `SELECT id, section, seq, description, unit, planned, actual, tolerance, result, remarks, photo_file
       FROM atp_items WHERE atp_id = :id ORDER BY section, seq, id`, { id: atpId });
  return { h, items };
}

const itemDto = (i) => ({
  id: i.id, section: i.section, seq: i.seq, description: i.description, unit: i.unit,
  planned: i.planned, actual: i.actual, tolerance: i.tolerance, result: i.result, remarks: i.remarks,
  photoUrl: files.signFile('hse', i.photoFile),
  suggested: suggestResult(i.planned, i.actual, i.tolerance),
});

function summary(items) {
  return {
    total: items.length,
    approve: items.filter((i) => i.result === 'APPROVE').length,
    reject: items.filter((i) => i.result === 'REJECT').length,
    empty: items.filter((i) => !i.result).length,
  };
}

function actionsFor(user, h) {
  const editable = ['DRAFT', 'REVISION'].includes(h.status);
  const writer = can(user.roleCode, 'writeAtp');
  return {
    edit: editable && writer,
    submit: editable && writer,
    approve: h.status === 'SUBMITTED' && can(user.roleCode, 'approveAtp') && h.submittedBy !== user.id,
    returnForRevision: h.status === 'SUBMITTED' && can(user.roleCode, 'approveAtp'),
    print: true,
  };
}

async function requireSignature(user) {
  const u = await db.one('SELECT signature_file FROM users WHERE id = :id', { id: user.id });
  if (!u?.signatureFile) {
    throw unprocessable('Anda belum mengunggah tanda tangan digital. Unggah tanda tangan di menu Profil terlebih dahulu.', { code: 'SIGNATURE_REQUIRED' });
  }
  return u.signatureFile;
}

// ------------------------------------------------------------------ cetak (token)
router.get('/:id/print', async (req, res) => {
  const atpId = id.parse(req.params.id);
  const p = files.verify(req.query.t, 'atp');
  if (p.r !== atpId) throw forbidden();
  const { h, items } = await loadAtp(atpId);
  const nonce = crypto.randomBytes(16).toString('base64');
  res.setHeader('Content-Security-Policy',
    `default-src 'none'; img-src 'self' data:; style-src 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(buildAtpHtml({
    h, items: items.map(itemDto), sections: lib.SECTIONS, site: await loadSiteReport(h.siteId), nonce,
    signatures: { submitted: files.signFile('signatures', h.submittedSig), approved: files.signFile('signatures', h.approvedSig) },
  }));
});

router.use(authenticate, requirePermission('viewAtp'));

router.get('/meta', (req, res) => {
  res.json({
    sections: lib.SECTIONS, sectionsId: lib.SECTIONS_ID, standardItems: lib.STANDARD_ITEMS, statusLabel: STATUS_LABEL,
    permissions: { write: can(req.user.roleCode, 'writeAtp'), approve: can(req.user.roleCode, 'approveAtp') },
  });
});

router.get('/', async (req, res) => {
  const q = z.object({ siteId: id.optional(), status: z.enum(Object.keys(STATUS_LABEL)).optional() }).parse(req.query);
  const where = [];
  const binds = {};
  const siteId = siteScope(req.user) || q.siteId;
  if (siteId) { where.push('a.site_id = :siteId'); binds.siteId = siteId; }
  if (q.status) { where.push('a.status = :status'); binds.status = q.status; }
  const list = await db.rows(
    `SELECT a.id, a.site_id, s.name AS site_name, a.doc_no, a.work_area, TO_CHAR(a.inspection_date, 'YYYY-MM-DD') AS inspection_date,
            a.status, u.full_name AS created_by_name,
            (SELECT COUNT(*) FROM atp_items i WHERE i.atp_id = a.id) AS item_count,
            (SELECT COUNT(*) FROM atp_items i WHERE i.atp_id = a.id AND i.result = 'REJECT') AS reject_count
       FROM atp_documents a JOIN sites s ON s.id = a.site_id JOIN users u ON u.id = a.created_by
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.inspection_date DESC, a.id DESC FETCH FIRST 500 ROWS ONLY`, binds);
  res.json({ documents: list.map((d) => ({ ...d, statusLabel: STATUS_LABEL[d.status] })) });
});

const createSchema = z.object({
  siteId: id,
  workArea: z.string().trim().min(1, 'Lokasi/area pekerjaan wajib diisi').max(200),
  inspectionDate: dateStr.optional(),
  sections: z.array(z.enum(['A', 'B', 'C', 'D', 'E', 'F'])).min(1, 'Pilih minimal satu jenis pekerjaan'),
});

router.post('/', requirePermission('writeAtp'), async (req, res) => {
  const d = createSchema.parse(req.body);
  assertSite(req.user, d.siteId);
  const date = d.inspectionDate || localDate();
  if (date > localDate()) throw badRequest('Tanggal pemeriksaan tidak boleh di masa depan');
  const newId = await db.withConnection(async (conn) => {
    const r = await db.x(conn,
      `INSERT INTO atp_documents (site_id, doc_no, work_area, inspection_date, created_by)
       VALUES (:s, :tmp, :w, TO_DATE(:d, 'YYYY-MM-DD'), :actorId) RETURNING id INTO :newId`,
      { s: d.siteId, tmp: `TMP-${crypto.randomUUID()}`, w: d.workArea, d: date, actorId: req.user.id,
        newId: { dir: db.oracledb.BIND_OUT, type: db.oracledb.NUMBER } });
    const atpId = r.outBinds.newId[0];
    await db.x(conn, 'UPDATE atp_documents SET doc_no = :no WHERE id = :id',
      { no: `ATP-${date.replace(/-/g, '')}-${String(atpId).padStart(4, '0')}`, id: atpId });
    for (const sec of [...new Set(d.sections)].sort()) {
      for (const [i, [desc, unit]] of (lib.STANDARD_ITEMS[sec] || []).entries()) {
        await db.x(conn, 'INSERT INTO atp_items (atp_id, section, seq, description, unit) VALUES (:a, :s, :q, :d, :u)',
          { a: atpId, s: sec, q: i + 1, d: desc, u: unit || null });
      }
    }
    return atpId;
  });
  await audit(req.user.id, 'ATP_CREATE', `id=${newId} site=${d.siteId} sections=${d.sections.join('')}`, req.ip);
  res.status(201).json({ id: newId });
});

router.get('/:id', async (req, res) => {
  const { h, items } = await loadAtp(id.parse(req.params.id));
  assertSite(req.user, h.siteId);
  const dto = items.map(itemDto);
  const { submittedSig, approvedSig, ...header } = h;
  res.json({
    document: { ...header, statusLabel: STATUS_LABEL[h.status] },
    items: dto,
    summary: summary(dto),
    actions: actionsFor(req.user, h),
    signatures: { submitted: files.signFile('signatures', submittedSig), approved: files.signFile('signatures', approvedSig) },
  });
});

const txt = (max) => z.preprocess((v) => (v == null ? null : String(v).trim() || null), z.string().max(max).nullable().optional());
const updateSchema = z.object({
  workArea: z.string().trim().min(1).max(200).optional(),
  inspectionDate: dateStr.optional(),
  notes: optionalText(1000),
  items: z.array(z.object({
    id: id.optional(),
    section: z.enum(['A', 'B', 'C', 'D', 'E', 'F']),
    description: z.string().trim().min(1, 'Deskripsi item wajib diisi').max(200),
    unit: txt(20), planned: txt(60), actual: txt(60), tolerance: txt(60),
    result: z.enum(['APPROVE', 'REJECT']).nullable().optional(),
    remarks: txt(500),
  })).max(200).optional(),
});

router.put('/:id', requirePermission('writeAtp'), async (req, res) => {
  const atpId = id.parse(req.params.id);
  const d = updateSchema.parse(req.body);
  const { h, items } = await loadAtp(atpId);
  assertSite(req.user, h.siteId);
  if (!actionsFor(req.user, h).edit) throw forbidden('Dokumen sudah dikirim dan tidak dapat diubah. Minta dikembalikan untuk revisi.');
  if (d.inspectionDate && d.inspectionDate > localDate()) throw badRequest('Tanggal pemeriksaan tidak boleh di masa depan');
  const removedPhotos = [];
  await db.withConnection(async (conn) => {
    await db.x(conn,
      `UPDATE atp_documents SET work_area = NVL(:w, work_area), inspection_date = NVL(TO_DATE(:d, 'YYYY-MM-DD'), inspection_date),
              notes = :n, updated_at = SYSTIMESTAMP WHERE id = :id`,
      { w: d.workArea ?? null, d: d.inspectionDate ?? null, n: d.notes !== undefined ? d.notes : h.notes, id: atpId });
    if (d.items) {
      const existing = new Map(items.map((i) => [i.id, i]));
      const keep = new Set();
      const seqBySection = {};
      for (const it of d.items) {
        const seq = (seqBySection[it.section] = (seqBySection[it.section] || 0) + 1);
        const b = { s: it.section, q: seq, d: it.description, u: it.unit ?? null, p: it.planned ?? null, a: it.actual ?? null,
          t: it.tolerance ?? null, r: it.result ?? null, m: it.remarks ?? null };
        if (it.id) {
          if (!existing.has(it.id)) throw badRequest('Item tidak termasuk dalam dokumen ini');
          keep.add(it.id);
          await db.x(conn, `UPDATE atp_items SET section = :s, seq = :q, description = :d, unit = :u, planned = :p, actual = :a,
                            tolerance = :t, result = :r, remarks = :m WHERE id = :id AND atp_id = :atp`, { ...b, id: it.id, atp: atpId });
        } else {
          await db.x(conn, `INSERT INTO atp_items (atp_id, section, seq, description, unit, planned, actual, tolerance, result, remarks)
                            VALUES (:atp, :s, :q, :d, :u, :p, :a, :t, :r, :m)`, { ...b, atp: atpId });
        }
      }
      for (const old of items) {
        if (!keep.has(old.id)) {
          await db.x(conn, 'DELETE FROM atp_items WHERE id = :id', { id: old.id });
          if (old.photoFile) removedPhotos.push(old.photoFile);
        }
      }
    }
  });
  for (const f of removedPhotos) await files.removeFile('hse', f);
  res.json({ message: 'ATP disimpan' });
});

router.post('/:id/items/:itemId/photo', requirePermission('writeAtp'), files.upload.single('photo'), async (req, res) => {
  const atpId = id.parse(req.params.id);
  const itemId = id.parse(req.params.itemId);
  if (!req.file) throw badRequest('Foto wajib diunggah');
  const { h, items } = await loadAtp(atpId);
  assertSite(req.user, h.siteId);
  if (!actionsFor(req.user, h).edit) throw forbidden('Dokumen sudah dikirim dan tidak dapat diubah');
  const it = items.find((i) => i.id === itemId);
  if (!it) throw notFound('Item tidak ditemukan');
  const name = await files.saveImage('hse', req.file.buffer);
  await db.query('UPDATE atp_items SET photo_file = :f WHERE id = :id', { f: name, id: itemId });
  if (it.photoFile) await files.removeFile('hse', it.photoFile);
  res.json({ photoUrl: files.signFile('hse', name) });
});

async function transition(atpId, from, sets, binds) {
  const r = await db.query(
    `UPDATE atp_documents SET ${sets}, updated_at = SYSTIMESTAMP WHERE id = :id AND status IN (${from.map((x) => `'${x}'`).join(',')})`,
    { id: atpId, ...binds });
  if (r.rowsAffected !== 1) throw conflict('Status dokumen sudah berubah. Muat ulang data.');
}

router.post('/:id/submit', requirePermission('writeAtp'), async (req, res) => {
  const atpId = id.parse(req.params.id);
  const { h, items } = await loadAtp(atpId);
  assertSite(req.user, h.siteId);
  if (!actionsFor(req.user, h).submit) throw forbidden('Dokumen tidak dapat dikirim');
  if (!items.length) throw unprocessable('Tambahkan minimal satu item pemeriksaan');
  const empty = items.filter((i) => !i.result);
  if (empty.length) throw unprocessable(`${empty.length} item belum diberi hasil APPROVE/REJECT`, { emptyItems: empty.map((i) => i.id) });
  const noReason = items.filter((i) => i.result === 'REJECT' && !i.remarks);
  if (noReason.length) throw unprocessable(`Item REJECT wajib diberi keterangan perbaikan (${noReason.map((i) => i.description).join(', ')})`);
  const sig = await requireSignature(req.user);
  await transition(atpId, ['DRAFT', 'REVISION'],
    `status = 'SUBMITTED', submitted_by = :u, submitted_at = SYSTIMESTAMP, submitted_sig = :sig,
     approved_by = NULL, approved_at = NULL, approved_sig = NULL`, { u: req.user.id, sig });
  await audit(req.user.id, 'ATP_SUBMIT', `id=${atpId}`, req.ip);
  res.json({ message: 'ATP dikirim ke Project Manager' });
});

router.post('/:id/approve', requirePermission('approveAtp'), async (req, res) => {
  const atpId = id.parse(req.params.id);
  const { h } = await loadAtp(atpId);
  assertSite(req.user, h.siteId);
  if (!actionsFor(req.user, h).approve) throw forbidden('Anda tidak dapat menyetujui dokumen ini');
  const sig = await requireSignature(req.user);
  await transition(atpId, ['SUBMITTED'], "status = 'APPROVED', approved_by = :u, approved_at = SYSTIMESTAMP, approved_sig = :sig",
    { u: req.user.id, sig });
  await audit(req.user.id, 'ATP_APPROVE', `id=${atpId}`, req.ip);
  res.json({ message: 'ATP disetujui. Cetak untuk ditandatangani Inspektur/pengawas.' });
});

router.post('/:id/return', requirePermission('approveAtp'), async (req, res) => {
  const atpId = id.parse(req.params.id);
  const { note } = z.object({ note: z.string().trim().min(1, 'Catatan revisi wajib diisi').max(1000) }).parse(req.body);
  const { h } = await loadAtp(atpId);
  assertSite(req.user, h.siteId);
  await transition(atpId, ['SUBMITTED'], "status = 'REVISION', revision_note = :n", { n: `${req.user.fullName}: ${note}` });
  await audit(req.user.id, 'ATP_RETURN', `id=${atpId} ${note}`, req.ip);
  res.json({ message: 'ATP dikembalikan ke Site Manager untuk revisi' });
});

router.post('/:id/print-link', async (req, res) => {
  const atpId = id.parse(req.params.id);
  const { h } = await loadAtp(atpId);
  assertSite(req.user, h.siteId);
  const t = jwt.sign({ p: 'atp', r: atpId }, config.jwt.secret, { expiresIn: '15m', algorithm: 'HS256' });
  res.json({ url: `/api/atp/${atpId}/print?t=${encodeURIComponent(t)}` });
});

module.exports = router;
