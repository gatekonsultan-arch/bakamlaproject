'use strict';
const express = require('express');
const db = require('../db');
const config = require('../config');
const { z, optionalText, id } = require('../validation');
const { authenticate, requirePermission } = require('../middleware/auth');
const { can, siteScope, ROLES } = require('../roles');
const { localDate, isValidDateStr } = require('../utils/time');
const { badRequest, forbidden, notFound, conflict, unprocessable, isUniqueViolation } = require('../utils/errors');
const { audit } = require('../utils/audit');
const files = require('../utils/files');
const lib = require('../reports/hseLibrary');
const { buildHtml } = require('../reports/hsePrint');

const router = express.Router();

const STATUS_LABEL = {
  DRAFT: 'Draf',
  SUBMITTED: 'Menunggu diketahui PIC Site',
  ACKNOWLEDGED: 'Menunggu persetujuan HSE Manager',
  APPROVED: 'Disetujui',
  REVISION: 'Perlu revisi',
};
const MAX_PHOTOS = 60;
const clob = (v) => ({ val: JSON.stringify(v), type: db.oracledb.DB_TYPE_CLOB });

// ------------------------------------------------------------------ helper
function assertSiteAccess(user, siteId) {
  const scope = siteScope(user);
  if (scope && scope !== siteId) throw forbidden('Anda hanya dapat mengakses laporan lokasi kerja Anda');
}

async function loadSettings(siteId) {
  const row = await db.one('SELECT settings FROM site_report_settings WHERE site_id = :id', { id: siteId });
  const stored = row ? JSON.parse(row.settings) : {};
  return { ...lib.DEFAULT_SETTINGS, ...stored, img: { ...lib.DEFAULT_SETTINGS.img, ...(stored.img || {}) } };
}

function settingsDto(s) {
  return {
    ...s,
    imgUrl: Object.fromEntries(Object.entries(s.img).map(([k, v]) => [k, files.signFile('settings', v)])),
  };
}

const HEADER = `
  SELECT h.id, h.site_id, s.name AS site_name, TO_CHAR(h.report_date, 'YYYY-MM-DD') AS report_date,
         h.report_no, h.status, h.start_time, h.finish_time, h.category, h.subject, h.content,
         h.created_by, cu.full_name AS created_by_name, h.updated_at,
         h.submitted_by, su.full_name AS submitted_by_name, su.signature_file AS submitted_sig, h.submitted_at,
         h.acknowledged_by, au.full_name AS acknowledged_by_name, au.signature_file AS acknowledged_sig, h.acknowledged_at,
         h.approved_by, pu.full_name AS approved_by_name, pu.signature_file AS approved_sig, h.approved_at,
         h.revision_note
    FROM hse_reports h
    JOIN sites s ON s.id = h.site_id
    JOIN users cu ON cu.id = h.created_by
    LEFT JOIN users su ON su.id = h.submitted_by
    LEFT JOIN users au ON au.id = h.acknowledged_by
    LEFT JOIN users pu ON pu.id = h.approved_by`;

async function loadReport(reportId) {
  const h = await db.one(`${HEADER} WHERE h.id = :id`, { id: reportId });
  if (!h) throw notFound('Laporan tidak ditemukan');
  h.content = { ...lib.DEFAULT_CONTENT, ...JSON.parse(h.content) };
  return h;
}

async function loadPhotos(reportId) {
  return db.rows(
    `SELECT id, file_name, original, taken_time, activity_key, caption, sky, included, sort_order
       FROM hse_report_photos WHERE report_id = :id
      ORDER BY NVL(taken_time, '99:99'), sort_order, id`,
    { id: reportId },
  );
}

const photoDto = (p) => ({
  id: p.id,
  url: files.signFile('hse', p.fileName),
  original: p.original,
  takenTime: p.takenTime,
  activityKey: p.activityKey,
  caption: p.caption,
  sky: p.sky,
  included: p.included === 1,
  sortOrder: p.sortOrder,
});

/** Anggota tim: pegawai yang absen di lokasi pada tanggal tsb + personel tambahan di pengaturan/laporan. */
async function loadMembers(h, settings) {
  const out = [];
  const seen = new Set();
  const add = (name, position, source) => {
    const key = String(name || '').trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ name: String(name).trim(), position: position || 'Worker', source });
  };
  if (settings.useAttendance !== false) {
    const att = await db.rows(
      `SELECT u.full_name, r.name AS role_name, a.check_in_at, a.check_out_at
         FROM attendance a JOIN users u ON u.id = a.user_id JOIN roles r ON r.id = u.role_id
        WHERE a.site_id = :siteId AND a.att_date = TO_DATE(:d, 'YYYY-MM-DD')
        ORDER BY a.check_in_at`,
      { siteId: h.siteId, d: h.reportDate },
    );
    att.forEach((a) => add(a.fullName, a.roleName, 'attendance'));
  }
  (settings.members || []).forEach((m) => add(m[0], m[1], 'settings'));
  (h.content.extraMembers || []).forEach((m) => add(m[0], m[1], 'report'));
  return out;
}

function actionsFor(user, h) {
  const editable = ['DRAFT', 'REVISION'].includes(h.status);
  const isWriter = can(user.roleCode, 'writeHseReports')
    && (h.createdBy === user.id || [ROLES.HSE_MANAGER, ROLES.SUPERADMIN].includes(user.roleCode));
  return {
    edit: editable && isWriter,
    submit: editable && isWriter,
    acknowledge: h.status === 'SUBMITTED' && can(user.roleCode, 'acknowledgeHseReports') && h.submittedBy !== user.id,
    approve: h.status === 'ACKNOWLEDGED' && can(user.roleCode, 'approveHseReports') && h.submittedBy !== user.id,
    returnForRevision:
      (h.status === 'SUBMITTED' && can(user.roleCode, 'acknowledgeHseReports'))
      || (h.status === 'ACKNOWLEDGED' && can(user.roleCode, 'approveHseReports')),
    print: true,
  };
}

function assertEditable(user, h) {
  if (!actionsFor(user, h).edit) {
    throw forbidden(['DRAFT', 'REVISION'].includes(h.status)
      ? 'Anda tidak berhak mengubah laporan ini'
      : 'Laporan sudah dikirim dan tidak dapat diubah. Minta dikembalikan untuk revisi.');
  }
}

/** Peta cuaca per tanggal dalam satu bulan (untuk tabel cuaca kumulatif). */
async function weatherMonth(siteId, date) {
  const rows = await db.rows(
    `SELECT TO_CHAR(report_date, 'YYYY-MM-DD') AS d, content FROM hse_reports
      WHERE site_id = :siteId AND report_date BETWEEN TRUNC(TO_DATE(:d, 'YYYY-MM-DD'), 'MM') AND TO_DATE(:d, 'YYYY-MM-DD')`,
    { siteId, d: date },
  );
  const out = {};
  rows.forEach((r) => { out[r.d] = (JSON.parse(r.content).weather) || {}; });
  return out;
}

// ------------------------------------------------------------------ cetak (tanpa header Authorization)
// GET /api/hse-reports/:id/print?t=<token 15 menit dari /print-link>
router.get('/:id/print', async (req, res) => {
  const reportId = id.parse(req.params.id);
  const p = files.verify(req.query.t, 'print');
  if (p.r !== reportId) throw forbidden();
  const h = await loadReport(reportId);
  const settings = await loadSettings(h.siteId);
  const photos = (await loadPhotos(reportId)).map(photoDto);
  const members = await loadMembers(h, settings);
  const nonce = require('crypto').randomBytes(16).toString('base64');
  const html = buildHtml({
    report: h,
    settings: settingsDto(settings),
    photos,
    members,
    weather: await weatherMonth(h.siteId, h.reportDate),
    signatures: {
      prepared: files.signFile('signatures', h.submittedSig),
      acknowledged: files.signFile('signatures', h.acknowledgedSig),
      approved: files.signFile('signatures', h.approvedSig),
    },
    lang: p.l === 'id' ? 'id' : 'en',
    nonce,
  });
  res.setHeader('Content-Security-Policy',
    `default-src 'none'; img-src 'self' data:; style-src 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(html);
});

router.use(authenticate, requirePermission('viewHseReports'));

// ------------------------------------------------------------------ referensi
router.get('/meta', (req, res) => {
  res.json({
    activities: lib.ACTIVITIES,
    checklist: lib.CHECKLIST,
    checklistId: lib.CHECKLIST_ID,
    weather: lib.WEATHER,
    weatherId: lib.WEATHER_ID,
    statusLabel: STATUS_LABEL,
    permissions: {
      write: can(req.user.roleCode, 'writeHseReports'),
      settings: can(req.user.roleCode, 'manageReportSettings'),
    },
  });
});

// ------------------------------------------------------------------ tanda tangan pengguna
router.get('/me/signature', async (req, res) => {
  const u = await db.one('SELECT signature_file FROM users WHERE id = :id', { id: req.user.id });
  res.json({ url: files.signFile('signatures', u.signatureFile) });
});

router.post('/me/signature', files.upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('File tanda tangan wajib diunggah');
  const name = await files.saveImage('signatures', req.file.buffer, { maxSize: 600, format: 'png' });
  const old = await db.one('SELECT signature_file FROM users WHERE id = :id', { id: req.user.id });
  await db.query('UPDATE users SET signature_file = :f WHERE id = :id', { f: name, id: req.user.id });
  if (old.signatureFile) await files.removeFile('signatures', old.signatureFile);
  await audit(req.user.id, 'SIGNATURE_UPDATE', null, req.ip);
  res.json({ url: files.signFile('signatures', name) });
});

// ------------------------------------------------------------------ pengaturan per lokasi
router.get('/settings/:siteId', async (req, res) => {
  const siteId = id.parse(req.params.siteId);
  assertSiteAccess(req.user, siteId);
  res.json({ settings: settingsDto(await loadSettings(siteId)) });
});

const pair = z.tuple([z.string().trim().max(120), z.string().trim().max(120)]);
const settingsSchema = z.object({
  head: z.string().trim().max(200),
  title: z.string().trim().max(200),
  proj: z.string().trim().max(200),
  loc: z.string().trim().max(300),
  client: z.string().trim().max(120),
  con: z.string().trim().max(150),
  start: z.string().refine(isValidDateStr, 'Format tanggal YYYY-MM-DD').nullable(),
  noFmt: z.string().trim().min(1).max(80),
  insp: z.array(z.string().trim().max(120)).max(20),
  members: z.array(pair).max(100),
  pic: z.string().trim().max(120),
  hse: z.string().trim().max(120),
  pm: z.string().trim().max(120),
  hseM: z.string().trim().max(120),
  ppe: z.array(z.tuple([z.string().trim().max(80), z.string().trim().max(120), z.boolean()])).max(30),
  tbm: z.boolean(),
  brk: z.number().min(0).max(4),
  useAttendance: z.boolean(),
}).partial();

router.put('/settings/:siteId', requirePermission('manageReportSettings'), async (req, res) => {
  const siteId = id.parse(req.params.siteId);
  const d = settingsSchema.parse(req.body);
  const current = await loadSettings(siteId);
  const next = { ...current, ...d, img: current.img };
  await db.query(
    `MERGE INTO site_report_settings t USING (SELECT :siteId AS site_id FROM dual) s ON (t.site_id = s.site_id)
     WHEN MATCHED THEN UPDATE SET settings = :json, updated_by = :actorId, updated_at = SYSTIMESTAMP
     WHEN NOT MATCHED THEN INSERT (site_id, settings, updated_by) VALUES (:siteId, :json, :actorId)`,
    { siteId, json: clob(next), actorId: req.user.id },
  );
  await audit(req.user.id, 'REPORT_SETTINGS_UPDATE', `site=${siteId}`, req.ip);
  res.json({ settings: settingsDto(next) });
});

router.post('/settings/:siteId/image/:slot', requirePermission('manageReportSettings'),
  files.upload.single('file'), async (req, res) => {
    const siteId = id.parse(req.params.siteId);
    const slot = z.enum(['logoL', 'logoR', 'site']).parse(req.params.slot);
    if (!req.file) throw badRequest('File gambar wajib diunggah');
    const name = await files.saveImage('settings', req.file.buffer,
      { maxSize: slot === 'site' ? 2400 : 600, format: slot === 'site' ? 'jpeg' : 'png' });
    const current = await loadSettings(siteId);
    const old = current.img[slot];
    const next = { ...current, img: { ...current.img, [slot]: name } };
    await db.query(
      `MERGE INTO site_report_settings t USING (SELECT :siteId AS site_id FROM dual) s ON (t.site_id = s.site_id)
       WHEN MATCHED THEN UPDATE SET settings = :json, updated_by = :actorId, updated_at = SYSTIMESTAMP
       WHEN NOT MATCHED THEN INSERT (site_id, settings, updated_by) VALUES (:siteId, :json, :actorId)`,
      { siteId, json: clob(next), actorId: req.user.id },
    );
    if (old) await files.removeFile('settings', old);
    res.json({ settings: settingsDto(next) });
  });

// ------------------------------------------------------------------ daftar & buat laporan
router.get('/', async (req, res) => {
  const q = z.object({
    siteId: id.optional(),
    status: z.enum(Object.keys(STATUS_LABEL)).optional(),
    from: z.string().refine(isValidDateStr).optional(),
    to: z.string().refine(isValidDateStr).optional(),
  }).parse(req.query);
  const where = [];
  const binds = {};
  const siteId = siteScope(req.user) || q.siteId;
  if (siteId) { where.push('h.site_id = :siteId'); binds.siteId = siteId; }
  if (q.status) { where.push('h.status = :status'); binds.status = q.status; }
  if (q.from) { where.push("h.report_date >= TO_DATE(:f, 'YYYY-MM-DD')"); binds.f = q.from; }
  if (q.to) { where.push("h.report_date <= TO_DATE(:t, 'YYYY-MM-DD')"); binds.t = q.to; }
  const list = await db.rows(
    `SELECT h.id, h.site_id, s.name AS site_name, TO_CHAR(h.report_date, 'YYYY-MM-DD') AS report_date,
            h.report_no, h.status, h.category, u.full_name AS created_by_name, h.updated_at,
            (SELECT COUNT(*) FROM hse_report_photos p WHERE p.report_id = h.id) AS photo_count
       FROM hse_reports h JOIN sites s ON s.id = h.site_id JOIN users u ON u.id = h.created_by
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY h.report_date DESC, s.name FETCH FIRST 500 ROWS ONLY`,
    binds,
  );
  res.json({ reports: list.map((r) => ({ ...r, statusLabel: STATUS_LABEL[r.status] })) });
});

router.post('/', requirePermission('writeHseReports'), async (req, res) => {
  const d = z.object({ siteId: id, date: z.string().refine(isValidDateStr, 'Format tanggal YYYY-MM-DD').optional() })
    .parse(req.body);
  assertSiteAccess(req.user, d.siteId);
  const date = d.date || localDate();
  if (date > localDate()) throw badRequest('Tanggal laporan tidak boleh di masa depan');
  const site = await db.one('SELECT id FROM sites WHERE id = :id', { id: d.siteId });
  if (!site) throw badRequest('Lokasi tidak ditemukan');
  const settings = await loadSettings(d.siteId);
  const content = { ...lib.DEFAULT_CONTENT };
  if (settings.tbm) {
    const t = lib.ACTIVITIES.tbm;
    content.activities = [{ key: 'tbm', time: '08:00', caption: t.c, work: t.w, obs: t.o, heavy: false, hse: false }];
  }
  try {
    const r = await db.query(
      `INSERT INTO hse_reports (site_id, report_date, report_no, content, created_by)
       VALUES (:siteId, TO_DATE(:d, 'YYYY-MM-DD'), :no, :content, :actorId) RETURNING id INTO :newId`,
      { siteId: d.siteId, d: date, no: lib.reportNumber(settings, date), content: clob(content),
        actorId: req.user.id, newId: { dir: db.oracledb.BIND_OUT, type: db.oracledb.NUMBER } },
    );
    const newId = r.outBinds.newId[0];
    await audit(req.user.id, 'HSE_REPORT_CREATE', `id=${newId} site=${d.siteId} date=${date}`, req.ip);
    res.status(201).json({ id: newId });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('Laporan untuk lokasi dan tanggal ini sudah ada');
    throw err;
  }
});

router.get('/:id', async (req, res) => {
  const h = await loadReport(id.parse(req.params.id));
  assertSiteAccess(req.user, h.siteId);
  const settings = await loadSettings(h.siteId);
  res.json({
    report: {
      id: h.id, siteId: h.siteId, siteName: h.siteName, reportDate: h.reportDate, reportNo: h.reportNo,
      status: h.status, statusLabel: STATUS_LABEL[h.status], startTime: h.startTime, finishTime: h.finishTime,
      category: h.category, subject: h.subject, content: h.content,
      createdByName: h.createdByName, submittedByName: h.submittedByName, submittedAt: h.submittedAt,
      acknowledgedByName: h.acknowledgedByName, acknowledgedAt: h.acknowledgedAt,
      approvedByName: h.approvedByName, approvedAt: h.approvedAt, revisionNote: h.revisionNote,
      updatedAt: h.updatedAt,
    },
    photos: (await loadPhotos(h.id)).map(photoDto),
    members: await loadMembers(h, settings),
    settings: settingsDto(settings),
    actions: actionsFor(req.user, h),
  });
});

// ------------------------------------------------------------------ ubah isi laporan
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format jam HH:MM');
const text = (max) => z.string().max(max);
const contentSchema = z.object({
  notes: text(4000),
  conclusion: text(2000),
  checklist: z.array(z.boolean()).length(lib.CHECKLIST.length),
  briefing: text(4000),
  monitoring: text(2000),
  incident: z.object({
    occurred: z.boolean(), type: text(200), timeLoc: text(200), desc: text(1000), loss: text(500), action: text(1000),
  }),
  activities: z.array(z.object({
    key: z.enum(Object.keys(lib.ACTIVITIES)),
    time,
    caption: text(120),
    work: text(500),
    obs: text(300),
    heavy: z.boolean(),
    hse: z.boolean(),
  })).max(40),
  weather: z.record(z.string().regex(/^([0-9]|1[0-9]|2[0-3])$/), z.enum(['S', 'C', 'L', 'H', ''])),
  weatherPhotos: z.object({ mid: id.nullable(), aft: id.nullable() }),
  siteTitle: z.enum(['SITE PLAN', 'BUILDING LAYOUT', 'COLUMN PLAN', 'WORK PROGRESS LAYOUT']),
  siteNote: text(1000),
  sitePhotoId: id.nullable(),
  extraMembers: z.array(pair).max(100),
}).partial();

const updateSchema = z.object({
  startTime: time.optional(),
  finishTime: time.optional(),
  category: optionalText(200),
  subject: optionalText(300),
  content: contentSchema.optional(),
});

router.put('/:id', requirePermission('writeHseReports'), async (req, res) => {
  const reportId = id.parse(req.params.id);
  const d = updateSchema.parse(req.body);
  const h = await loadReport(reportId);
  assertSiteAccess(req.user, h.siteId);
  assertEditable(req.user, h);
  const start = d.startTime || h.startTime;
  const finish = d.finishTime || h.finishTime;
  if (start >= finish) throw badRequest('Jam selesai harus setelah jam mulai');

  const content = { ...h.content, ...(d.content || {}) };
  await db.query(
    `UPDATE hse_reports SET start_time = :st, finish_time = :fi, category = :cat, subject = :subj,
            content = :content, updated_at = SYSTIMESTAMP WHERE id = :id`,
    { st: start, fi: finish, cat: d.category !== undefined ? d.category : h.category,
      subj: d.subject !== undefined ? d.subject : h.subject, content: clob(content), id: reportId },
  );
  res.json({ message: 'Laporan disimpan' });
});

// ------------------------------------------------------------------ foto
router.post('/:id/photos', requirePermission('writeHseReports'), files.upload.array('photos', 20), async (req, res) => {
  const reportId = id.parse(req.params.id);
  const h = await loadReport(reportId);
  assertSiteAccess(req.user, h.siteId);
  assertEditable(req.user, h);
  const list = req.files || [];
  if (!list.length) throw badRequest('Pilih minimal satu foto');
  const count = await db.one('SELECT COUNT(*) AS n, NVL(MAX(sort_order), 0) AS mx FROM hse_report_photos WHERE report_id = :id', { id: reportId });
  if (count.n + list.length > MAX_PHOTOS) throw unprocessable(`Maksimal ${MAX_PHOTOS} foto per laporan`);

  // Jam dari aplikasi (opsional, satu per file, boleh dipisah koma) dipakai bila foto tidak punya EXIF.
  const clientTimes = [].concat(req.body.takenTime || []).flatMap((v) => String(v).split(','));
  const saved = [];
  let order = count.mx;
  for (const [i, f] of list.entries()) {
    const exif = await files.exifTime(f.buffer);
    const fallback = /^([01]\d|2[0-3]):[0-5]\d$/.test(clientTimes[i] || '') ? clientTimes[i] : null;
    const name = await files.saveImage('hse', f.buffer);
    order += 1;
    await db.query(
      `INSERT INTO hse_report_photos (report_id, file_name, original, taken_time, caption, sort_order, uploaded_by)
       VALUES (:r, :f, :o, :t, :c, :s, :u)`,
      { r: reportId, f: name, o: String(f.originalname || '').slice(0, 255), t: exif || fallback,
        c: lib.ACTIVITIES.custom.c, s: order, u: req.user.id },
    );
    saved.push(name);
  }
  await audit(req.user.id, 'HSE_PHOTO_UPLOAD', `report=${reportId} n=${saved.length}`, req.ip);
  res.status(201).json({ photos: (await loadPhotos(reportId)).map(photoDto) });
});

const photoUpdate = z.object({
  takenTime: time.nullable().optional(),
  activityKey: z.enum(Object.keys(lib.ACTIVITIES)).optional(),
  caption: z.string().trim().max(120).optional(),
  sky: z.enum(['S', 'C', 'L', 'H', '']).optional(),
  included: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
});

router.put('/:id/photos/:photoId', requirePermission('writeHseReports'), async (req, res) => {
  const reportId = id.parse(req.params.id);
  const photoId = id.parse(req.params.photoId);
  const d = photoUpdate.parse(req.body);
  const h = await loadReport(reportId);
  assertSiteAccess(req.user, h.siteId);
  assertEditable(req.user, h);
  const cols = { takenTime: 'taken_time', activityKey: 'activity_key', caption: 'caption', sky: 'sky', included: 'included', sortOrder: 'sort_order' };
  const sets = [];
  const binds = { id: photoId, r: reportId };
  for (const [k, col] of Object.entries(cols)) {
    if (d[k] !== undefined) {
      sets.push(`${col} = :${k}`);
      binds[k] = k === 'included' ? (d[k] ? 1 : 0) : (d[k] === '' ? null : d[k]);
    }
  }
  if (!sets.length) throw badRequest('Tidak ada perubahan');
  const r = await db.query(`UPDATE hse_report_photos SET ${sets.join(', ')} WHERE id = :id AND report_id = :r`, binds);
  if (r.rowsAffected !== 1) throw notFound('Foto tidak ditemukan');
  res.json({ message: 'Foto diperbarui' });
});

router.delete('/:id/photos/:photoId', requirePermission('writeHseReports'), async (req, res) => {
  const reportId = id.parse(req.params.id);
  const photoId = id.parse(req.params.photoId);
  const h = await loadReport(reportId);
  assertSiteAccess(req.user, h.siteId);
  assertEditable(req.user, h);
  const p = await db.one('SELECT file_name FROM hse_report_photos WHERE id = :id AND report_id = :r', { id: photoId, r: reportId });
  if (!p) throw notFound('Foto tidak ditemukan');
  await db.query('DELETE FROM hse_report_photos WHERE id = :id', { id: photoId });
  await files.removeFile('hse', p.fileName);
  res.json({ message: 'Foto dihapus' });
});

// ------------------------------------------------------------------ alur persetujuan
async function transition(reportId, from, sets, binds) {
  const r = await db.query(
    `UPDATE hse_reports SET ${sets}, updated_at = SYSTIMESTAMP WHERE id = :id AND status IN (${from.map((s) => `'${s}'`).join(',')})`,
    { id: reportId, ...binds },
  );
  if (r.rowsAffected !== 1) throw conflict('Status laporan sudah berubah. Muat ulang data.');
}

router.post('/:id/submit', requirePermission('writeHseReports'), async (req, res) => {
  const reportId = id.parse(req.params.id);
  const h = await loadReport(reportId);
  assertSiteAccess(req.user, h.siteId);
  if (!actionsFor(req.user, h).submit) throw forbidden('Laporan tidak dapat dikirim');
  if (!h.content.activities.length) throw unprocessable('Isi minimal satu aktivitas sebelum mengirim laporan');
  if (h.content.incident.occurred && !h.content.incident.desc.trim()) {
    throw unprocessable('Uraian insiden wajib diisi karena laporan menyatakan ada insiden');
  }
  await transition(reportId, ['DRAFT', 'REVISION'],
    'status = \'SUBMITTED\', submitted_by = :u, submitted_at = SYSTIMESTAMP, acknowledged_by = NULL, acknowledged_at = NULL, approved_by = NULL, approved_at = NULL',
    { u: req.user.id });
  await audit(req.user.id, 'HSE_REPORT_SUBMIT', `id=${reportId}`, req.ip);
  res.json({ message: 'Laporan dikirim ke PIC Site untuk diketahui' });
});

router.post('/:id/acknowledge', requirePermission('acknowledgeHseReports'), async (req, res) => {
  const reportId = id.parse(req.params.id);
  const h = await loadReport(reportId);
  assertSiteAccess(req.user, h.siteId);
  if (!actionsFor(req.user, h).acknowledge) throw forbidden('Anda tidak dapat memproses laporan ini');
  await transition(reportId, ['SUBMITTED'], 'status = \'ACKNOWLEDGED\', acknowledged_by = :u, acknowledged_at = SYSTIMESTAMP', { u: req.user.id });
  await audit(req.user.id, 'HSE_REPORT_ACKNOWLEDGE', `id=${reportId}`, req.ip);
  res.json({ message: 'Laporan diketahui, diteruskan ke HSE Manager' });
});

router.post('/:id/approve', requirePermission('approveHseReports'), async (req, res) => {
  const reportId = id.parse(req.params.id);
  const h = await loadReport(reportId);
  assertSiteAccess(req.user, h.siteId);
  if (!actionsFor(req.user, h).approve) throw forbidden('Anda tidak dapat menyetujui laporan ini');
  await transition(reportId, ['ACKNOWLEDGED'], 'status = \'APPROVED\', approved_by = :u, approved_at = SYSTIMESTAMP', { u: req.user.id });
  await audit(req.user.id, 'HSE_REPORT_APPROVE', `id=${reportId}`, req.ip);
  res.json({ message: 'Laporan disetujui' });
});

router.post('/:id/return', async (req, res) => {
  const reportId = id.parse(req.params.id);
  const { note } = z.object({ note: z.string().trim().min(1, 'Catatan revisi wajib diisi').max(1000) }).parse(req.body);
  const h = await loadReport(reportId);
  assertSiteAccess(req.user, h.siteId);
  if (!actionsFor(req.user, h).returnForRevision) throw forbidden('Anda tidak dapat mengembalikan laporan ini');
  await transition(reportId, ['SUBMITTED', 'ACKNOWLEDGED'], 'status = \'REVISION\', revision_note = :n', { n: `${req.user.fullName}: ${note}` });
  await audit(req.user.id, 'HSE_REPORT_RETURN', `id=${reportId} ${note}`, req.ip);
  res.json({ message: 'Laporan dikembalikan untuk revisi' });
});

router.post('/:id/print-link', async (req, res) => {
  const reportId = id.parse(req.params.id);
  const { lang } = z.object({ lang: z.enum(['en', 'id']).default('en') }).parse(req.body || {});
  const h = await loadReport(reportId);
  assertSiteAccess(req.user, h.siteId);
  const t = files.signPrint(reportId, req.user.id, lang);
  res.json({ url: `/api/hse-reports/${reportId}/print?t=${encodeURIComponent(t)}`, expiresInMinutes: 15 });
});

module.exports = router;
module.exports.config = config;
