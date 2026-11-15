'use strict';
const express = require('express');
const config = require('../config');
const db = require('../db');
const { z, id } = require('../validation');
const { authenticate, requirePermission } = require('../middleware/auth');
const { ALL_ROLES, SITE_SCOPED_REPORT_ROLES } = require('../roles');
const { distanceMeters, nearestSite } = require('../utils/geo');
const { localDate, isValidDateStr, daysBetween } = require('../utils/time');
const { badRequest, conflict, forbidden, unprocessable, isUniqueViolation } = require('../utils/errors');
const { audit } = require('../utils/audit');
const crypto = require('crypto');
const files = require('../utils/files');
const face = require('../utils/face');

const router = express.Router();
router.use(authenticate);

const MAX_RANGE_DAYS = 93;

// Field bisa datang sebagai JSON atau multipart (string) karena check-in menyertakan foto selfie.
const num = (schema) => z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), schema);
const bool = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean().optional().default(false));
const locationSchema = z.object({
  latitude: num(z.number().min(-90).max(90)),
  longitude: num(z.number().min(-180).max(180)),
  accuracy: num(z.number().min(0).max(100000).nullable().optional()),
  isMocked: bool,
  note: z.string().trim().max(255).optional(),
  deviceInfo: z.string().trim().max(255).optional(),
});

const SELECT = `
  SELECT a.id, a.user_id, u.full_name, u.username, r.code AS role_code, r.name AS role_name,
         a.site_id, s.name AS site_name, TO_CHAR(a.att_date, 'YYYY-MM-DD') AS att_date,
         a.check_in_at, a.check_in_lat, a.check_in_lng, a.check_in_accuracy, a.check_in_distance_m,
         a.check_out_at, a.check_out_lat, a.check_out_lng, a.check_out_accuracy, a.check_out_distance_m,
         a.note, a.check_in_photo, a.check_out_photo, a.check_in_face_score, a.check_out_face_score,
         CASE WHEN a.photos_purged_at IS NOT NULL THEN 1 ELSE 0 END AS photos_purged
    FROM attendance a
    JOIN users u ON u.id = a.user_id
    JOIN roles r ON r.id = u.role_id
    JOIN sites s ON s.id = a.site_id`;

const round = (n) => (n == null ? null : Math.round(n * 10) / 10);

/** Validasi kualitas lokasi yang dikirim perangkat. */
function assertLocationQuality(loc) {
  if (config.rejectMockLocation && loc.isMocked) {
    throw unprocessable('Terdeteksi lokasi palsu (mock location). Matikan aplikasi pemalsu lokasi.');
  }
  if (loc.accuracy == null || loc.accuracy > config.maxGpsAccuracyM) {
    throw unprocessable(
      `Akurasi GPS kurang baik (${loc.accuracy == null ? 'tidak diketahui' : `${Math.round(loc.accuracy)} m`}). ` +
        `Maksimal ${config.maxGpsAccuracyM} m. Pindah ke area terbuka lalu coba lagi.`,
    );
  }
}

/**
 * Tentukan lokasi kerja user. Jika user ditugaskan ke site tertentu,
 * ia hanya boleh absen di site itu. Jika tidak, dipakai site aktif terdekat.
 */
async function resolveSite(user, lat, lng) {
  let site;
  let distance;
  if (user.siteId) {
    site = await db.one(
      'SELECT id, name, latitude, longitude, radius_m FROM sites WHERE id = :id AND is_active = 1',
      { id: user.siteId },
    );
    if (!site) throw unprocessable('Lokasi kerja Anda tidak aktif. Hubungi admin.');
    distance = distanceMeters(lat, lng, site.latitude, site.longitude);
  } else {
    const sites = await db.rows(
      'SELECT id, name, latitude, longitude, radius_m FROM sites WHERE is_active = 1',
    );
    if (!sites.length) throw unprocessable('Belum ada lokasi kerja yang terdaftar. Hubungi admin.');
    ({ site, distance } = nearestSite(lat, lng, sites));
  }
  if (distance > site.radiusM) {
    throw unprocessable(
      `Anda berada di luar area ${site.name} (jarak ${Math.round(distance)} m, maksimal ${site.radiusM} m).`,
      { siteId: site.id, siteName: site.name, distanceM: round(distance), radiusM: site.radiusM },
    );
  }
  return { site, distance };
}

function toDto(a) {
  return {
    id: a.id,
    userId: a.userId,
    fullName: a.fullName,
    username: a.username,
    role: a.roleCode,
    roleName: a.roleName,
    siteId: a.siteId,
    siteName: a.siteName,
    date: a.attDate,
    checkIn: {
      at: a.checkInAt,
      latitude: a.checkInLat,
      longitude: a.checkInLng,
      accuracy: a.checkInAccuracy,
      distanceM: a.checkInDistanceM,
      photoUrl: files.signFile('faces', a.checkInPhoto),
      faceScore: a.checkInFaceScore,
    },
    checkOut: a.checkOutAt
      ? {
          at: a.checkOutAt,
          latitude: a.checkOutLat,
          longitude: a.checkOutLng,
          accuracy: a.checkOutAccuracy,
          distanceM: a.checkOutDistanceM,
          photoUrl: files.signFile('faces', a.checkOutPhoto),
          faceScore: a.checkOutFaceScore,
        }
      : null,
    note: a.note,
    photosPurged: a.photosPurged === 1,
  };
}

// ---------- Selfie wajah ----------

/**
 * Validasi selfie: persetujuan UU PDP, foto ada, belum pernah dipakai, tepat satu wajah.
 * Mengembalikan data foto yang siap disimpan (file belum ditulis).
 */
async function verifySelfie(req) {
  if (!config.requireSelfie) return null;
  const u = await db.one('SELECT face_consent_at FROM users WHERE id = :id', { id: req.user.id });
  if (!u.faceConsentAt) {
    throw forbidden('Anda perlu menyetujui pengambilan foto wajah untuk absensi terlebih dahulu.', { code: 'FACE_CONSENT_REQUIRED' });
  }
  if (!req.file) throw badRequest('Selfie wajah wajib saat absen.', { code: 'SELFIE_REQUIRED' });
  const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  const used = await db.one('SELECT user_id FROM attendance_photo_hashes WHERE photo_hash = :h', { h: hash });
  if (used) throw conflict('Foto ini sudah pernah dipakai untuk absen. Ambil selfie baru.', { code: 'SELFIE_REUSED' });
  let check;
  try {
    check = await face.checkSelfie(req.file.buffer);
  } catch (err) {
    if (err.status) throw err;
    throw badRequest('Foto tidak dapat dibaca. Ambil ulang selfie.');
  }
  if (!check.ok) throw unprocessable(check.reason, { code: 'FACE_REJECTED', faces: check.faces });
  return { hash, score: check.score };
}

async function storeSelfie(req, selfie) {
  if (!selfie) return null;
  return files.saveImage('faces', req.file.buffer, { maxSize: 800 });
}

// ---------- Persetujuan foto wajah (UU No. 27/2022 Pelindungan Data Pribadi) ----------
const CONSENT_TEXT = 'Saya menyetujui pengambilan foto wajah (selfie) setiap kali absen, untuk tujuan verifikasi kehadiran. '
  + 'Foto hanya dapat dilihat oleh atasan yang berwenang, disimpan paling lama {days} hari lalu dihapus otomatis, '
  + 'dan tidak digunakan untuk tujuan lain. Saya dapat menarik persetujuan ini melalui admin.';

router.get('/face-consent', async (req, res) => {
  const u = await db.one('SELECT face_consent_at FROM users WHERE id = :id', { id: req.user.id });
  res.json({
    required: config.requireSelfie,
    consentedAt: u.faceConsentAt,
    retentionDays: config.facePhotoRetentionDays,
    text: CONSENT_TEXT.replace('{days}', config.facePhotoRetentionDays),
  });
});

router.post('/face-consent', async (req, res) => {
  const { agree } = z.object({ agree: z.literal(true, { message: 'Persetujuan wajib dicentang' }) }).parse(req.body);
  await db.query('UPDATE users SET face_consent_at = SYSTIMESTAMP WHERE id = :id AND face_consent_at IS NULL', { id: req.user.id });
  await audit(req.user.id, 'FACE_CONSENT', `agree=${agree}`, req.ip);
  res.json({ message: 'Persetujuan tersimpan' });
});

// ---------- Absensi milik sendiri (semua role) ----------

router.get('/today', async (req, res) => {
  const today = localDate();
  const row = await db.one(
    `${SELECT} WHERE a.user_id = :userId AND a.att_date = TO_DATE(:d, 'YYYY-MM-DD')`,
    { userId: req.user.id, d: today },
  );
  res.json({ date: today, timezone: config.timezone, attendance: row ? toDto(row) : null });
});

router.post('/check-in', files.upload.single('photo'), async (req, res) => {
  const loc = locationSchema.parse(req.body);
  assertLocationQuality(loc);
  const { site, distance } = await resolveSite(req.user, loc.latitude, loc.longitude);
  const today = localDate();
  const existing = await db.one(
    "SELECT id FROM attendance WHERE user_id = :u AND att_date = TO_DATE(:d, 'YYYY-MM-DD')", { u: req.user.id, d: today });
  if (existing) throw conflict('Anda sudah melakukan check-in hari ini');
  const selfie = await verifySelfie(req);
  const photo = await storeSelfie(req, selfie);

  try {
    await db.withConnection(async (conn) => {
      await conn.execute(
        `INSERT INTO attendance
           (user_id, site_id, att_date, check_in_at, check_in_lat, check_in_lng,
            check_in_accuracy, check_in_distance_m, note, device_info, ip_address,
            check_in_photo, check_in_face_score)
         VALUES (:userId, :siteId, TO_DATE(:d, 'YYYY-MM-DD'), SYSTIMESTAMP, :lat, :lng,
                 :acc, :dist, :note, :device, :ip, :photo, :score)`,
        {
          userId: req.user.id, siteId: site.id, d: today, lat: loc.latitude, lng: loc.longitude,
          acc: loc.accuracy ?? null, dist: round(distance), note: loc.note || null,
          device: loc.deviceInfo || null, ip: req.ip ? String(req.ip).slice(0, 45) : null,
          photo, score: selfie?.score ?? null,
        },
      );
      if (selfie) {
        await conn.execute('INSERT INTO attendance_photo_hashes (photo_hash, user_id) VALUES (:h, :u)', { h: selfie.hash, u: req.user.id });
      }
    });
  } catch (err) {
    if (photo) await files.removeFile('faces', photo);
    if (isUniqueViolation(err)) throw conflict('Anda sudah melakukan check-in hari ini');
    throw err;
  }
  await audit(req.user.id, 'CHECK_IN', `site=${site.id} dist=${round(distance)}`, req.ip);
  const row = await db.one(
    `${SELECT} WHERE a.user_id = :userId AND a.att_date = TO_DATE(:d, 'YYYY-MM-DD')`,
    { userId: req.user.id, d: today },
  );
  res.status(201).json({ message: `Check-in berhasil di ${site.name}`, attendance: toDto(row) });
});

router.post('/check-out', files.upload.single('photo'), async (req, res) => {
  const loc = locationSchema.parse(req.body);
  assertLocationQuality(loc);
  const today = localDate();

  const att = await db.one(
    `SELECT a.id, a.check_out_at, s.id AS site_id, s.name, s.latitude, s.longitude, s.radius_m
       FROM attendance a JOIN sites s ON s.id = a.site_id
      WHERE a.user_id = :userId AND a.att_date = TO_DATE(:d, 'YYYY-MM-DD')`,
    { userId: req.user.id, d: today },
  );
  if (!att) throw badRequest('Anda belum check-in hari ini');
  if (att.checkOutAt) throw conflict('Anda sudah melakukan check-out hari ini');

  const distance = distanceMeters(loc.latitude, loc.longitude, att.latitude, att.longitude);
  if (distance > att.radiusM) {
    throw unprocessable(
      `Anda berada di luar area ${att.name} (jarak ${Math.round(distance)} m, maksimal ${att.radiusM} m).`,
      { siteId: att.siteId, siteName: att.name, distanceM: round(distance), radiusM: att.radiusM },
    );
  }

  const selfie = await verifySelfie(req);
  const photo = await storeSelfie(req, selfie);
  let affected = 0;
  try {
    affected = await db.withConnection(async (conn) => {
      const r = await conn.execute(
        `UPDATE attendance
            SET check_out_at = SYSTIMESTAMP, check_out_lat = :lat, check_out_lng = :lng,
                check_out_accuracy = :acc, check_out_distance_m = :dist,
                note = NVL(:note, note), check_out_photo = :photo, check_out_face_score = :score
          WHERE id = :id AND check_out_at IS NULL`,
        {
          lat: loc.latitude, lng: loc.longitude, acc: loc.accuracy ?? null,
          dist: round(distance), note: loc.note || null, id: att.id, photo, score: selfie?.score ?? null,
        },
      );
      if (r.rowsAffected === 1 && selfie) {
        await conn.execute('INSERT INTO attendance_photo_hashes (photo_hash, user_id) VALUES (:h, :u)', { h: selfie.hash, u: req.user.id });
      }
      return r.rowsAffected;
    });
  } catch (err) {
    if (photo) await files.removeFile('faces', photo);
    throw err;
  }
  if (affected !== 1) {
    if (photo) await files.removeFile('faces', photo);
    throw conflict('Anda sudah melakukan check-out hari ini');
  }
  await audit(req.user.id, 'CHECK_OUT', `site=${att.siteId} dist=${round(distance)}`, req.ip);

  const row = await db.one(`${SELECT} WHERE a.id = :id`, { id: att.id });
  res.json({ message: `Check-out berhasil di ${att.name}`, attendance: toDto(row) });
});

function parseRange(query) {
  const today = localDate();
  const from = query.from || today;
  const to = query.to || today;
  if (!isValidDateStr(from) || !isValidDateStr(to)) {
    throw badRequest('Format tanggal harus YYYY-MM-DD');
  }
  const days = daysBetween(from, to);
  if (days < 0) throw badRequest('Tanggal awal harus sebelum tanggal akhir');
  if (days > MAX_RANGE_DAYS) throw badRequest(`Rentang maksimal ${MAX_RANGE_DAYS} hari`);
  return { from, to };
}

router.get('/me', async (req, res) => {
  const { from, to } = parseRange({
    from: req.query.from || localDate(new Date(Date.now() - 30 * 86400000)),
    to: req.query.to,
  });
  const list = await db.rows(
    `${SELECT} WHERE a.user_id = :userId
        AND a.att_date BETWEEN TO_DATE(:f, 'YYYY-MM-DD') AND TO_DATE(:t, 'YYYY-MM-DD')
      ORDER BY a.att_date DESC`,
    { userId: req.user.id, f: from, t: to },
  );
  res.json({ from, to, attendance: list.map(toDto) });
});

// ---------- Laporan (Superadmin, Admin, Project/Site/HSE Manager) ----------

const reportQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  siteId: id.optional(),
  userId: id.optional(),
  role: z.enum(ALL_ROLES).optional(),
});

/** Bangun filter laporan; Site Manager otomatis dibatasi ke site-nya. */
function buildReportFilter(user, q) {
  const { from, to } = parseRange(q);
  const where = ["a.att_date BETWEEN TO_DATE(:f, 'YYYY-MM-DD') AND TO_DATE(:t, 'YYYY-MM-DD')"];
  const binds = { f: from, t: to };

  let siteId = q.siteId;
  if (SITE_SCOPED_REPORT_ROLES.includes(user.roleCode)) {
    siteId = user.siteId || -1; // tanpa site -> tidak ada data
  }
  if (siteId) { where.push('a.site_id = :siteId'); binds.siteId = siteId; }
  if (q.userId) { where.push('a.user_id = :userId'); binds.userId = q.userId; }
  if (q.role) { where.push('r.code = :role'); binds.role = q.role; }
  return { from, to, where: where.join(' AND '), binds };
}

router.get('/', requirePermission('viewReports'), async (req, res) => {
  const q = reportQuery.parse(req.query);
  const f = buildReportFilter(req.user, q);
  const list = await db.rows(
    `${SELECT} WHERE ${f.where} ORDER BY a.att_date DESC, u.full_name FETCH FIRST 2000 ROWS ONLY`,
    f.binds,
  );
  res.json({ from: f.from, to: f.to, attendance: list.map(toDto) });
});

router.get('/summary', requirePermission('viewReports'), async (req, res) => {
  const date = req.query.date || localDate();
  if (!isValidDateStr(date)) throw badRequest('Format tanggal harus YYYY-MM-DD');

  const scoped = SITE_SCOPED_REPORT_ROLES.includes(req.user.roleCode);
  const siteFilter = scoped ? 'AND u.site_id = :siteId' : '';
  const binds = { d: date, ...(scoped ? { siteId: req.user.siteId || -1 } : {}) };

  const s = await db.one(
    `SELECT COUNT(*) AS total_users,
            COUNT(a.id) AS present,
            COUNT(a.check_out_at) AS checked_out
       FROM users u
       LEFT JOIN attendance a ON a.user_id = u.id AND a.att_date = TO_DATE(:d, 'YYYY-MM-DD')
      WHERE u.is_active = 1 ${siteFilter}`,
    binds,
  );
  const absent = await db.rows(
    `SELECT u.id, u.full_name, r.name AS role_name, st.name AS site_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN sites st ON st.id = u.site_id
      WHERE u.is_active = 1 ${siteFilter}
        AND NOT EXISTS (SELECT 1 FROM attendance a
                         WHERE a.user_id = u.id AND a.att_date = TO_DATE(:d, 'YYYY-MM-DD'))
      ORDER BY u.full_name FETCH FIRST 500 ROWS ONLY`,
    binds,
  );
  res.json({
    date,
    totalUsers: s.totalUsers,
    present: s.present,
    checkedOut: s.checkedOut,
    absent: absent.map((u) => ({ id: u.id, fullName: u.fullName, roleName: u.roleName, siteName: u.siteName })),
  });
});

const csvCell = (v) => {
  if (v == null) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  // Cegah CSV/formula injection saat dibuka di Excel.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

router.get('/export.csv', requirePermission('viewReports'), async (req, res) => {
  const q = reportQuery.parse(req.query);
  const f = buildReportFilter(req.user, q);
  const list = await db.rows(
    `${SELECT} WHERE ${f.where} ORDER BY a.att_date, u.full_name FETCH FIRST 50000 ROWS ONLY`,
    f.binds,
  );
  const fmt = (d) =>
    d ? new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone, dateStyle: 'short', timeStyle: 'medium' }).format(d) : '';
  const header = [
    'Tanggal', 'Nama', 'Username', 'Role', 'Lokasi', 'Jam Masuk', 'Lat Masuk', 'Lng Masuk',
    'Jarak Masuk (m)', 'Jam Pulang', 'Lat Pulang', 'Lng Pulang', 'Jarak Pulang (m)', 'Catatan',
  ];
  const lines = [header.join(',')];
  for (const a of list) {
    lines.push([
      a.attDate, a.fullName, a.username, a.roleName, a.siteName, fmt(a.checkInAt), a.checkInLat,
      a.checkInLng, a.checkInDistanceM, fmt(a.checkOutAt), a.checkOutLat, a.checkOutLng,
      a.checkOutDistanceM, a.note,
    ].map(csvCell).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="absensi_${f.from}_${f.to}.csv"`);
  res.send(`﻿${lines.join('\r\n')}`);
});

module.exports = router;
