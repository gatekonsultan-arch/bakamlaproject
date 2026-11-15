'use strict';
const express = require('express');
const db = require('../db');
const config = require('../config');
const { z, optionalText, id } = require('../validation');
const { authenticate, requirePermission } = require('../middleware/auth');
const { can, ROLES } = require('../roles');
const { distanceMeters } = require('../utils/geo');
const { localDate, isValidDateStr } = require('../utils/time');
const { badRequest, forbidden, notFound, conflict, unprocessable } = require('../utils/errors');
const { audit } = require('../utils/audit');
const files = require('../utils/files');
const pay = require('../utils/payroll');
const { buildPayrollHtml } = require('../reports/payrollPrint');

const router = express.Router();
const dateStr = z.string().refine(isValidDateStr, 'Format tanggal YYYY-MM-DD');
const clob = (v) => ({ val: JSON.stringify(v), type: db.oracledb.DB_TYPE_CLOB });

const STATUS_LABEL = {
  OPEN: 'Belum diajukan',
  SUBMITTED: 'Menunggu persetujuan PM',
  RETURNED: 'Dikembalikan untuk perbaikan',
  APPROVED: 'Disetujui (terkunci)',
  PAID: 'Sudah dibayar',
};
const LOCKED = ['SUBMITTED', 'APPROVED', 'PAID'];

/** Site Manager hanya boleh mengelola lokasinya sendiri. */
function assertSite(user, siteId) {
  if (user.roleCode === ROLES.SITE_MANAGER && user.siteId !== siteId) {
    throw forbidden('Anda hanya dapat mengelola tenaga kerja di lokasi Anda');
  }
}

async function weekRow(siteId, start) {
  return db.one(
    `SELECT p.id, p.status, p.total_amount, p.snapshot, p.return_note,
            su.full_name AS submitted_by_name, p.submitted_at, p.submitted_by, p.submitted_sig,
            au.full_name AS approved_by_name, p.approved_at, p.approved_sig,
            pu.full_name AS paid_by_name, p.paid_at
       FROM payroll_weeks p
       LEFT JOIN users su ON su.id = p.submitted_by
       LEFT JOIN users au ON au.id = p.approved_by
       LEFT JOIN users pu ON pu.id = p.paid_by
      WHERE p.site_id = :siteId AND p.week_start = TO_DATE(:ws, 'YYYY-MM-DD')`,
    { siteId, ws: start },
  );
}

async function assertWeekOpen(siteId, date) {
  const start = pay.weekStart(date);
  const w = await weekRow(siteId, start);
  if (w && LOCKED.includes(w.status)) {
    throw conflict(`Rekap pekan ${start} sudah ${STATUS_LABEL[w.status].toLowerCase()}. Data pekan ini tidak dapat diubah.`);
  }
}

const workerDto = (w) => ({
  id: w.id, siteId: w.siteId, siteName: w.siteName, name: w.name, category: w.category,
  categoryLabel: pay.CATEGORY_LABEL[w.category], trade: w.trade, nik: w.nik, phone: w.phone,
  dailyRate: pay.money(w.dailyRate), overtimeRate: pay.money(w.overtimeRate), isActive: w.isActive === 1,
});

const WORKER_SELECT = `SELECT w.*, s.name AS site_name FROM workers w JOIN sites s ON s.id = w.site_id`;

// ------------------------------------------------------------------ cetak & CSV (token bertanda tangan)
async function computeForSite(siteId, start) {
  const w = await weekRow(siteId, start);
  if (w && ['APPROVED', 'PAID'].includes(w.status) && w.snapshot) return { week: w, recap: JSON.parse(w.snapshot) };
  const days = pay.weekDays(start);
  const workers = (await db.rows(`${WORKER_SELECT} WHERE w.site_id = :siteId`, { siteId }))
    .map((x) => ({ ...workerDto(x), isActive: x.isActive === 1 }));
  const att = await db.rows(
    `SELECT worker_id, TO_CHAR(work_date, 'YYYY-MM-DD') AS work_date, status, overtime_hours, day_rate, ot_rate
       FROM worker_attendance
      WHERE site_id = :siteId AND work_date BETWEEN TO_DATE(:a, 'YYYY-MM-DD') AND TO_DATE(:b, 'YYYY-MM-DD')`,
    { siteId, a: days[0], b: days[5] },
  );
  const adv = await db.rows(
    `SELECT worker_id, amount FROM worker_advances
      WHERE site_id = :siteId AND adv_date BETWEEN TO_DATE(:a, 'YYYY-MM-DD') AND TO_DATE(:b, 'YYYY-MM-DD')`,
    { siteId, a: days[0], b: addSunday(days[5]) },
  );
  return { week: w, recap: pay.computeWeek(start, workers, att, adv) };
}
// Kasbon hari Minggu ikut dipotong pada pekan sebelumnya (pekan Senin-Sabtu + Minggu sesudahnya).
const addSunday = (sat) => pay.addDays(sat, 1);

router.get('/payroll/print', async (req, res) => {
  const p = files.verify(req.query.t, 'payroll');
  const site = await db.one('SELECT id, name FROM sites WHERE id = :id', { id: p.s });
  const { week, recap } = await computeForSite(p.s, p.w);
  const nonce = require('crypto').randomBytes(16).toString('base64');
  res.setHeader('Content-Security-Policy',
    `default-src 'none'; img-src 'self' data:; style-src 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  res.setHeader('Cache-Control', 'no-store');
  if (p.f === 'csv') {
    const cell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const sym = { FULL: 'H', HALF: '½', ABSENT: 'A' };
    const head = ['No', 'Nama', 'Kategori', 'Keahlian', ...recap.days.map((d) => d.slice(5)), 'Hari Kerja', 'Upah Harian', 'Upah', 'Jam Lembur', 'Upah Lembur', 'Kasbon', 'Diterima'];
    const lines = [head.join(',')];
    recap.rows.forEach((r, i) => lines.push([i + 1, r.name, pay.CATEGORY_LABEL[r.category], r.trade,
      ...recap.days.map((d) => (r.days[d] ? sym[r.days[d].status] + (r.days[d].overtimeHours ? `+${r.days[d].overtimeHours}j` : '') : '')),
      r.workDays, (r.ratesUsed || [r.dailyRate]).join(' / '), r.wage, r.overtimeHours, r.overtimePay, r.advance, r.net].map(cell).join(',')));
    lines.push(['', 'TOTAL', '', '', ...recap.days.map(() => ''), recap.totals.workDays, '', recap.totals.wage, recap.totals.overtimeHours, recap.totals.overtimePay, recap.totals.advance, recap.totals.net].map(cell).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rekap_upah_${site.name.replace(/\W+/g, '_')}_${p.w}.csv"`);
    return res.send(`﻿${lines.join('\r\n')}`);
  }
  res.type('html').send(buildPayrollHtml({
    site, recap, nonce,
    status: week?.status || 'OPEN',
    statusLabel: STATUS_LABEL[week?.status || 'OPEN'],
    submittedBy: week?.submittedByName, approvedBy: week?.approvedByName,
    submittedSig: files.signFile('signatures', week?.submittedSig),
    approvedSig: files.signFile('signatures', week?.approvedSig),
  }));
});

router.use(authenticate, requirePermission('viewWorkers'));

// ------------------------------------------------------------------ data pekerja
router.get('/', async (req, res) => {
  const q = z.object({ siteId: id.optional(), active: z.enum(['1', '0', 'all']).default('1') }).parse(req.query);
  const where = [];
  const binds = {};
  const siteId = req.user.roleCode === ROLES.SITE_MANAGER ? req.user.siteId || -1 : q.siteId;
  if (siteId) { where.push('w.site_id = :siteId'); binds.siteId = siteId; }
  if (q.active !== 'all') { where.push('w.is_active = :act'); binds.act = Number(q.active); }
  const list = await db.rows(
    `${WORKER_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY CASE w.category WHEN 'MANDOR' THEN 0 WHEN 'TUKANG' THEN 1 ELSE 2 END, w.name`,
    binds,
  );
  res.json({ workers: list.map(workerDto) });
});

const workerSchema = z.object({
  siteId: id,
  name: z.string().trim().min(1).max(120),
  category: z.enum(['MANDOR', 'TUKANG', 'BURUH']),
  trade: optionalText(60),
  nik: optionalText(20),
  phone: optionalText(30),
  dailyRate: z.number().min(0).max(1e9),
  overtimeRate: z.number().min(0).max(1e9).default(0),
  isActive: z.boolean().default(true),
});

router.post('/', requirePermission('manageWorkers'), async (req, res) => {
  const d = workerSchema.parse(req.body);
  assertSite(req.user, d.siteId);
  const r = await db.query(
    `INSERT INTO workers (site_id, name, category, trade, nik, phone, daily_rate, overtime_rate, is_active, created_by)
     VALUES (:siteId, :name, :cat, :trade, :nik, :phone, :rate, :ot, :act, :actorId) RETURNING id INTO :newId`,
    { siteId: d.siteId, name: d.name, cat: d.category, trade: d.trade ?? null, nik: d.nik ?? null, phone: d.phone ?? null,
      rate: d.dailyRate, ot: d.overtimeRate, act: d.isActive ? 1 : 0, actorId: req.user.id,
      newId: { dir: db.oracledb.BIND_OUT, type: db.oracledb.NUMBER } },
  );
  const newId = r.outBinds.newId[0];
  await audit(req.user.id, 'WORKER_CREATE', `id=${newId} ${d.name} ${d.category} rate=${d.dailyRate}`, req.ip);
  res.status(201).json({ worker: workerDto(await db.one(`${WORKER_SELECT} WHERE w.id = :id`, { id: newId })) });
});

// ------------------------------------------------------------------ absen harian
router.get('/attendance', async (req, res) => {
  const q = z.object({ siteId: id, date: dateStr.optional() }).parse(req.query);
  assertSite(req.user, q.siteId);
  const date = q.date || localDate();
  const start = pay.weekStart(date);
  const list = await db.rows(
    `SELECT w.id, w.name, w.category, w.trade, w.daily_rate, w.overtime_rate,
            a.status, a.overtime_hours, a.note, a.day_rate
       FROM workers w
       LEFT JOIN worker_attendance a ON a.worker_id = w.id AND a.work_date = TO_DATE(:d, 'YYYY-MM-DD')
      WHERE w.site_id = :siteId AND (w.is_active = 1 OR a.id IS NOT NULL)
      ORDER BY CASE w.category WHEN 'MANDOR' THEN 0 WHEN 'TUKANG' THEN 1 ELSE 2 END, w.name`,
    { siteId: q.siteId, d: date },
  );
  const sheet = await db.one(
    `SELECT d.distance_m, d.photo_file, u.full_name AS recorded_by_name, d.updated_at
       FROM worker_day_sheets d JOIN users u ON u.id = d.recorded_by
      WHERE d.site_id = :siteId AND d.work_date = TO_DATE(:d, 'YYYY-MM-DD')`,
    { siteId: q.siteId, d: date },
  );
  const week = await weekRow(q.siteId, start);
  res.json({
    date, weekStart: start, isSunday: pay.isoWeekday(date) === 7,
    locked: !!(week && LOCKED.includes(week.status)), weekStatus: week?.status || 'OPEN',
    canEdit: can(req.user.roleCode, 'recordWorkerAttendance'),
    sheet: sheet ? { ...sheet, photoUrl: files.signFile('hse', sheet.photoFile) } : null,
    entries: list.map((w) => ({
      workerId: w.id, name: w.name, category: w.category, trade: w.trade, dailyRate: pay.money(w.dailyRate),
      overtimeRate: pay.money(w.overtimeRate), status: w.status || null, overtimeHours: Number(w.overtimeHours) || 0, note: w.note,
    })),
  });
});

const sheetSchema = z.object({
  siteId: id,
  date: dateStr,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100000).nullable().optional(),
  isMocked: z.boolean().optional().default(false),
  entries: z.array(z.object({
    workerId: id,
    status: z.enum(['FULL', 'HALF', 'ABSENT']),
    overtimeHours: z.number().min(0).max(12).default(0),
    note: optionalText(255),
  })).min(1).max(500),
});

/** Validasi pengisi absen berada di lokasi proyek (geotag). */
async function checkLocation(siteId, d) {
  if (config.rejectMockLocation && d.isMocked) throw unprocessable('Terdeteksi lokasi palsu (mock location).');
  if (d.accuracy == null || d.accuracy > config.maxGpsAccuracyM) {
    throw unprocessable(`Akurasi GPS kurang baik. Maksimal ${config.maxGpsAccuracyM} m.`);
  }
  const site = await db.one('SELECT name, latitude, longitude, radius_m FROM sites WHERE id = :id', { id: siteId });
  if (!site) throw notFound('Lokasi tidak ditemukan');
  const dist = distanceMeters(d.latitude, d.longitude, site.latitude, site.longitude);
  if (dist > site.radiusM) {
    throw unprocessable(`Absensi tenaga kerja harus diisi di lokasi proyek. Anda berjarak ${Math.round(dist)} m dari ${site.name} (maks. ${site.radiusM} m).`);
  }
  return dist;
}

router.put('/attendance', requirePermission('recordWorkerAttendance'), async (req, res) => {
  const d = sheetSchema.parse(req.body);
  assertSite(req.user, d.siteId);
  const today = localDate();
  if (d.date > today) throw badRequest('Tidak dapat mengisi absensi untuk tanggal yang akan datang');
  if (pay.isoWeekday(d.date) === 7) throw badRequest('Hari Minggu tidak termasuk periode kerja (Senin–Sabtu)');
  if (pay.weekStart(d.date) !== pay.weekStart(today) && d.date < pay.addDays(today, -6)) {
    throw badRequest('Absensi hanya dapat diisi/diubah maksimal 6 hari ke belakang');
  }
  await assertWeekOpen(d.siteId, d.date);
  const dist = await checkLocation(d.siteId, d);
  const ids = d.entries.map((e) => e.workerId);
  if (new Set(ids).size !== ids.length) throw badRequest('Pekerja yang sama muncul dua kali');

  await db.withConnection(async (conn) => {
    for (const e of d.entries) {
      const w = (await db.x(conn, 'SELECT site_id, daily_rate, overtime_rate FROM workers WHERE id = :id', { id: e.workerId })).rows[0];
      if (!w || w.siteId !== d.siteId) throw badRequest(`Pekerja #${e.workerId} bukan pekerja di lokasi ini`);
      await db.x(conn,
        `MERGE INTO worker_attendance t
         USING (SELECT :wid AS worker_id, TO_DATE(:d, 'YYYY-MM-DD') AS work_date FROM dual) s
            ON (t.worker_id = s.worker_id AND t.work_date = s.work_date)
         WHEN MATCHED THEN UPDATE SET status = :st, overtime_hours = :ot,
              note = :note, recorded_by = :actorId, recorded_at = SYSTIMESTAMP
              -- day_rate/ot_rate tidak diubah: upah mengikuti tarif saat hari itu pertama kali dicatat
         WHEN NOT MATCHED THEN INSERT (worker_id, site_id, work_date, status, overtime_hours, day_rate, ot_rate, note, recorded_by)
              VALUES (:wid, :siteId, TO_DATE(:d, 'YYYY-MM-DD'), :st, :ot, :rate, :otr, :note, :actorId)`,
        { wid: e.workerId, d: d.date, st: e.status, ot: e.status === 'ABSENT' ? 0 : e.overtimeHours,
          rate: w.dailyRate, otr: w.overtimeRate, note: e.note ?? null, actorId: req.user.id, siteId: d.siteId });
    }
    await db.x(conn,
      `MERGE INTO worker_day_sheets t
       USING (SELECT :siteId AS site_id, TO_DATE(:d, 'YYYY-MM-DD') AS work_date FROM dual) s
          ON (t.site_id = s.site_id AND t.work_date = s.work_date)
       WHEN MATCHED THEN UPDATE SET latitude = :lat, longitude = :lng, accuracy = :acc, distance_m = :dist,
            recorded_by = :actorId, updated_at = SYSTIMESTAMP
       WHEN NOT MATCHED THEN INSERT (site_id, work_date, latitude, longitude, accuracy, distance_m, recorded_by)
            VALUES (:siteId, TO_DATE(:d, 'YYYY-MM-DD'), :lat, :lng, :acc, :dist, :actorId)`,
      { siteId: d.siteId, d: d.date, lat: d.latitude, lng: d.longitude, acc: d.accuracy ?? null,
        dist: Math.round(dist * 10) / 10, actorId: req.user.id });
  });
  const counts = d.entries.reduce((m, e) => ({ ...m, [e.status]: (m[e.status] || 0) + 1 }), {});
  await audit(req.user.id, 'WORKER_ATTENDANCE', `site=${d.siteId} date=${d.date} ${JSON.stringify(counts)}`, req.ip);
  res.json({ message: `Absensi ${d.entries.length} pekerja tersimpan (penuh ${counts.FULL || 0}, ½ hari ${counts.HALF || 0}, tidak masuk ${counts.ABSENT || 0})` });
});

router.post('/attendance/photo', requirePermission('recordWorkerAttendance'), files.upload.single('photo'), async (req, res) => {
  const d = z.object({ siteId: z.coerce.number().int().positive(), date: dateStr }).parse(req.body);
  assertSite(req.user, d.siteId);
  await assertWeekOpen(d.siteId, d.date);
  if (!req.file) throw badRequest('Foto wajib diunggah');
  const sheet = await db.one(`SELECT id, photo_file FROM worker_day_sheets WHERE site_id = :s AND work_date = TO_DATE(:d, 'YYYY-MM-DD')`, { s: d.siteId, d: d.date });
  if (!sheet) throw badRequest('Simpan absensi hari ini terlebih dahulu, lalu unggah foto apel');
  const name = await files.saveImage('hse', req.file.buffer);
  await db.query('UPDATE worker_day_sheets SET photo_file = :f WHERE id = :id', { f: name, id: sheet.id });
  if (sheet.photoFile) await files.removeFile('hse', sheet.photoFile);
  res.json({ photoUrl: files.signFile('hse', name) });
});

// ------------------------------------------------------------------ kasbon
router.get('/advances', async (req, res) => {
  const q = z.object({ siteId: id, weekStart: dateStr }).parse(req.query);
  assertSite(req.user, q.siteId);
  const list = await db.rows(
    `SELECT a.id, a.worker_id, w.name, TO_CHAR(a.adv_date, 'YYYY-MM-DD') AS adv_date, a.amount, a.note, u.full_name AS recorded_by_name
       FROM worker_advances a JOIN workers w ON w.id = a.worker_id JOIN users u ON u.id = a.recorded_by
      WHERE a.site_id = :s AND a.adv_date BETWEEN TO_DATE(:a, 'YYYY-MM-DD') AND TO_DATE(:b, 'YYYY-MM-DD')
      ORDER BY a.adv_date, w.name`,
    { s: q.siteId, a: q.weekStart, b: pay.addDays(q.weekStart, 6) },
  );
  res.json({ advances: list.map((a) => ({ ...a, amount: pay.money(a.amount) })) });
});

router.post('/advances', requirePermission('recordCashAdvance'), async (req, res) => {
  const d = z.object({ workerId: id, date: dateStr.optional(), amount: z.number().positive().max(1e9), note: optionalText(255) }).parse(req.body);
  const w = await db.one('SELECT site_id, name FROM workers WHERE id = :id', { id: d.workerId });
  if (!w) throw notFound('Pekerja tidak ditemukan');
  assertSite(req.user, w.siteId);
  const date = d.date || localDate();
  if (date > localDate()) throw badRequest('Tanggal kasbon tidak boleh di masa depan');
  await assertWeekOpen(w.siteId, pay.isoWeekday(date) === 7 ? pay.addDays(date, -1) : date);
  await db.query(
    `INSERT INTO worker_advances (worker_id, site_id, adv_date, amount, note, recorded_by)
     VALUES (:w, :s, TO_DATE(:d, 'YYYY-MM-DD'), :a, :n, :actorId)`,
    { w: d.workerId, s: w.siteId, d: date, a: d.amount, n: d.note ?? null, actorId: req.user.id },
  );
  await audit(req.user.id, 'WORKER_ADVANCE', `worker=${d.workerId} amount=${d.amount}`, req.ip);
  res.status(201).json({ message: `Kasbon ${w.name} dicatat` });
});

router.delete('/advances/:id', requirePermission('recordCashAdvance'), async (req, res) => {
  const aid = id.parse(req.params.id);
  const a = await db.one(`SELECT site_id, TO_CHAR(adv_date, 'YYYY-MM-DD') AS d, amount FROM worker_advances WHERE id = :id`, { id: aid });
  if (!a) throw notFound('Kasbon tidak ditemukan');
  assertSite(req.user, a.siteId);
  await assertWeekOpen(a.siteId, pay.isoWeekday(a.d) === 7 ? pay.addDays(a.d, -1) : a.d);
  await db.query('DELETE FROM worker_advances WHERE id = :id', { id: aid });
  await audit(req.user.id, 'WORKER_ADVANCE_DELETE', `id=${aid} amount=${a.amount}`, req.ip);
  res.json({ message: 'Kasbon dihapus' });
});

// ------------------------------------------------------------------ rekap upah mingguan
const weekQuery = z.object({ siteId: id, weekStart: dateStr.optional(), date: dateStr.optional() });

function actionsFor(user, w) {
  const st = w?.status || 'OPEN';
  return {
    submit: ['OPEN', 'RETURNED'].includes(st) && can(user.roleCode, 'submitPayroll'),
    approve: st === 'SUBMITTED' && can(user.roleCode, 'approvePayroll') && w.submittedBy !== user.id,
    returnForRevision: st === 'SUBMITTED' && can(user.roleCode, 'approvePayroll'),
    markPaid: st === 'APPROVED' && can(user.roleCode, 'markPayrollPaid'),
    addAdvance: !LOCKED.includes(st) && can(user.roleCode, 'recordCashAdvance'),
  };
}

router.get('/payroll', async (req, res) => {
  const q = weekQuery.parse(req.query);
  assertSite(req.user, q.siteId);
  const start = pay.weekStart(q.weekStart || q.date || localDate());
  const { week, recap } = await computeForSite(q.siteId, start);
  res.json({
    weekStart: start, weekEnd: recap.weekEnd,
    status: week?.status || 'OPEN', statusLabel: STATUS_LABEL[week?.status || 'OPEN'],
    submittedByName: week?.submittedByName, submittedAt: week?.submittedAt,
    approvedByName: week?.approvedByName, approvedAt: week?.approvedAt,
    paidByName: week?.paidByName, paidAt: week?.paidAt, returnNote: week?.returnNote,
    recap,
    actions: actionsFor(req.user, week),
  });
});

router.get('/payroll/weeks', async (req, res) => {
  const q = z.object({ siteId: id }).parse(req.query);
  assertSite(req.user, q.siteId);
  const list = await db.rows(
    `SELECT TO_CHAR(week_start, 'YYYY-MM-DD') AS week_start, status, total_amount FROM payroll_weeks
      WHERE site_id = :s ORDER BY week_start DESC FETCH FIRST 60 ROWS ONLY`, { s: q.siteId });
  res.json({ weeks: list.map((w) => ({ ...w, statusLabel: STATUS_LABEL[w.status] })) });
});

async function requireSignature(user) {
  const u = await db.one('SELECT signature_file FROM users WHERE id = :id', { id: user.id });
  if (!u?.signatureFile) {
    throw unprocessable('Anda belum mengunggah tanda tangan digital. Unggah tanda tangan di menu Profil terlebih dahulu.', { code: 'SIGNATURE_REQUIRED' });
  }
  return u.signatureFile;
}

const actionBody = z.object({ siteId: id, weekStart: dateStr, note: optionalText(500) });

router.post('/payroll/submit', requirePermission('submitPayroll'), async (req, res) => {
  const d = actionBody.parse(req.body);
  assertSite(req.user, d.siteId);
  if (pay.weekStart(d.weekStart) !== d.weekStart) throw badRequest('weekStart harus hari Senin');
  const w = await weekRow(d.siteId, d.weekStart);
  if (w && !['RETURNED'].includes(w.status)) throw conflict(`Rekap pekan ini sudah ${STATUS_LABEL[w.status].toLowerCase()}`);
  const { recap } = await computeForSite(d.siteId, d.weekStart);
  if (!recap.rows.some((r) => r.full + r.half + r.absent > 0)) throw unprocessable('Belum ada absensi tenaga kerja pada pekan ini');
  const sig = await requireSignature(req.user);
  await db.query(
    `MERGE INTO payroll_weeks t USING (SELECT :s AS site_id, TO_DATE(:ws, 'YYYY-MM-DD') AS week_start FROM dual) x
        ON (t.site_id = x.site_id AND t.week_start = x.week_start)
     WHEN MATCHED THEN UPDATE SET status = 'SUBMITTED', submitted_by = :actorId, submitted_at = SYSTIMESTAMP,
          submitted_sig = :sig, total_amount = :tot, return_note = NULL
     WHEN NOT MATCHED THEN INSERT (site_id, week_start, status, submitted_by, submitted_at, submitted_sig, total_amount)
          VALUES (:s, TO_DATE(:ws, 'YYYY-MM-DD'), 'SUBMITTED', :actorId, SYSTIMESTAMP, :sig, :tot)`,
    { s: d.siteId, ws: d.weekStart, actorId: req.user.id, sig, tot: recap.totals.net },
  );
  await audit(req.user.id, 'PAYROLL_SUBMIT', `site=${d.siteId} week=${d.weekStart} total=${recap.totals.net}`, req.ip);
  res.json({ message: 'Rekap upah diajukan ke Project Manager' });
});

router.post('/payroll/approve', requirePermission('approvePayroll'), async (req, res) => {
  const d = actionBody.parse(req.body);
  const w = await weekRow(d.siteId, d.weekStart);
  if (!w || w.status !== 'SUBMITTED') throw conflict('Rekap belum diajukan atau sudah diproses');
  if (w.submittedBy === req.user.id) throw forbidden('Anda tidak dapat menyetujui rekap yang Anda ajukan sendiri');
  const sig = await requireSignature(req.user);
  const { recap } = await computeForSite(d.siteId, d.weekStart);
  const r = await db.query(
    `UPDATE payroll_weeks SET status = 'APPROVED', approved_by = :actorId, approved_at = SYSTIMESTAMP, approved_sig = :sig,
            snapshot = :snap, total_amount = :tot WHERE id = :id AND status = 'SUBMITTED'`,
    { actorId: req.user.id, sig, snap: clob(recap), tot: recap.totals.net, id: w.id },
  );
  if (r.rowsAffected !== 1) throw conflict('Status rekap sudah berubah');
  await audit(req.user.id, 'PAYROLL_APPROVE', `site=${d.siteId} week=${d.weekStart} total=${recap.totals.net}`, req.ip);
  res.json({ message: 'Rekap upah disetujui dan dikunci' });
});

router.post('/payroll/return', requirePermission('approvePayroll'), async (req, res) => {
  const d = actionBody.parse(req.body);
  if (!d.note) throw badRequest('Catatan perbaikan wajib diisi');
  const r = await db.query(
    `UPDATE payroll_weeks SET status = 'RETURNED', return_note = :n
      WHERE site_id = :s AND week_start = TO_DATE(:ws, 'YYYY-MM-DD') AND status = 'SUBMITTED'`,
    { n: `${req.user.fullName}: ${d.note}`, s: d.siteId, ws: d.weekStart },
  );
  if (r.rowsAffected !== 1) throw conflict('Rekap belum diajukan atau sudah diproses');
  await audit(req.user.id, 'PAYROLL_RETURN', `site=${d.siteId} week=${d.weekStart} ${d.note}`, req.ip);
  res.json({ message: 'Rekap dikembalikan ke Site Manager untuk diperbaiki' });
});

router.post('/payroll/paid', requirePermission('markPayrollPaid'), async (req, res) => {
  const d = actionBody.parse(req.body);
  const r = await db.query(
    `UPDATE payroll_weeks SET status = 'PAID', paid_by = :actorId, paid_at = SYSTIMESTAMP
      WHERE site_id = :s AND week_start = TO_DATE(:ws, 'YYYY-MM-DD') AND status = 'APPROVED'`,
    { actorId: req.user.id, s: d.siteId, ws: d.weekStart },
  );
  if (r.rowsAffected !== 1) throw conflict('Rekap belum disetujui atau sudah dibayar');
  await audit(req.user.id, 'PAYROLL_PAID', `site=${d.siteId} week=${d.weekStart}`, req.ip);
  res.json({ message: 'Rekap ditandai sudah dibayar' });
});

router.post('/payroll/link', async (req, res) => {
  const d = z.object({ siteId: id, weekStart: dateStr, format: z.enum(['html', 'csv']).default('html') }).parse(req.body);
  assertSite(req.user, d.siteId);
  const jwt = require('jsonwebtoken');
  const t = jwt.sign({ p: 'payroll', s: d.siteId, w: pay.weekStart(d.weekStart), f: d.format, u: req.user.id },
    config.jwt.secret, { expiresIn: '15m', algorithm: 'HS256' });
  res.json({ url: `/api/workers/payroll/print?t=${encodeURIComponent(t)}` });
});

// Didaftarkan paling akhir agar tidak menangkap /attendance, /payroll, dst.
router.put('/:id', requirePermission('manageWorkers'), async (req, res) => {
  const wid = id.parse(req.params.id);
  const d = z.object({
    name: z.string().trim().min(1).max(120), category: z.enum(['MANDOR', 'TUKANG', 'BURUH']),
    trade: optionalText(60), nik: optionalText(20), phone: optionalText(30),
    dailyRate: z.number().min(0).max(1e9), overtimeRate: z.number().min(0).max(1e9), isActive: z.boolean(),
  }).partial().parse(req.body);
  const cur = await db.one(`${WORKER_SELECT} WHERE w.id = :id`, { id: wid });
  if (!cur) throw notFound('Pekerja tidak ditemukan');
  assertSite(req.user, cur.siteId);
  const cols = { name: 'name', category: 'category', trade: 'trade', nik: 'nik', phone: 'phone', dailyRate: 'daily_rate', overtimeRate: 'overtime_rate', isActive: 'is_active' };
  const sets = ['updated_at = SYSTIMESTAMP'];
  const binds = { id: wid };
  for (const [k, c] of Object.entries(cols)) {
    if (d[k] !== undefined) { sets.push(`${c} = :${k}`); binds[k] = k === 'isActive' ? (d[k] ? 1 : 0) : d[k]; }
  }
  await db.query(`UPDATE workers SET ${sets.join(', ')} WHERE id = :id`, binds);
  await audit(req.user.id, 'WORKER_UPDATE', `id=${wid} before_rate=${cur.dailyRate}/${cur.overtimeRate} ${JSON.stringify(d)}`, req.ip);
  res.json({ worker: workerDto(await db.one(`${WORKER_SELECT} WHERE w.id = :id`, { id: wid })) });
});

module.exports = router;
