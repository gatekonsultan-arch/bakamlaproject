'use strict';
/**
 * Uji alur utama terhadap API yang sedang berjalan (gunakan DB uji, bukan produksi!).
 *   API_URL=http://localhost:3000 SUPERADMIN_PASSWORD='...' TEST_SELFIE=/path/selfie.jpg node scripts/smoke-test.js
 */
const sharp = require('sharp');
const { selfie, postAttendance, consent } = require('./lib/selfie');

const BASE = process.env.API_URL || 'http://localhost:3000';
const SA_USER = process.env.SUPERADMIN_USERNAME || 'superadmin';
const SA_PASS = process.env.SUPERADMIN_PASSWORD;
let failures = 0;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

function expect(name, cond, info) {
  if (cond) console.log(`  OK   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, info !== undefined ? JSON.stringify(info) : ''); }
}

(async () => {
  const suffix = Date.now().toString(36);
  const login = await call('POST', '/api/auth/login', { body: { username: SA_USER, password: SA_PASS } });
  expect('superadmin login', login.status === 200 && login.body.token, login.body);
  const sa = login.body.token;

  const bad = await call('POST', '/api/auth/login', { body: { username: SA_USER, password: 'salah123' } });
  expect('password salah ditolak 401', bad.status === 401);

  const site = await call('POST', '/api/sites', {
    token: sa,
    body: { name: `Site Uji ${suffix}`, latitude: -5.0617, longitude: 119.4733, radiusM: 150 },
  });
  expect('buat site', site.status === 201, site.body);
  const siteId = site.body.site.id;

  const mkUser = (role, extra = {}) => call('POST', '/api/users', {
    token: sa,
    body: { username: `${role.toLowerCase()}_${suffix}`, fullName: `User ${role}`, password: 'Password123', role, siteId, ...extra },
  });
  const admin = await mkUser('ADMIN');
  expect('superadmin buat ADMIN', admin.status === 201, admin.body);
  const logi = await mkUser('LOGISTIK');
  expect('buat LOGISTIK', logi.status === 201, logi.body);
  const sm = await mkUser('SITE_MANAGER');
  expect('buat SITE_MANAGER', sm.status === 201, sm.body);
  const dup = await mkUser('LOGISTIK');
  expect('username duplikat 409', dup.status === 409, dup.body);
  const weak = await mkUser('HSE_MANAGER', { username: `weak_${suffix}`, password: 'abc' });
  expect('password lemah 400', weak.status === 400);

  const tok = async (u) => (await call('POST', '/api/auth/login', { body: { username: u, password: 'Password123' } })).body.token;
  const adminTok = await tok(`admin_${suffix}`);
  const logTok = await tok(`logistik_${suffix}`);
  const smTok = await tok(`site_manager_${suffix}`);

  const escal = await call('POST', '/api/users', {
    token: adminTok,
    body: { username: `x_${suffix}`, fullName: 'X', password: 'Password123', role: 'SUPERADMIN' },
  });
  expect('admin tidak bisa buat SUPERADMIN (403)', escal.status === 403);

  const noAccess = await call('GET', '/api/users', { token: logTok });
  expect('logistik tidak bisa lihat user (403)', noAccess.status === 403);
  const noReport = await call('GET', '/api/attendance', { token: logTok });
  expect('logistik tidak bisa lihat laporan (403)', noReport.status === 403);

  const IN = '/api/attendance/check-in';
  const OUT = '/api/attendance/check-out';
  const atSite = { latitude: -5.0619, longitude: 119.4735, accuracy: 12 };

  const far = await postAttendance(BASE, IN, logTok, { latitude: -5.08, longitude: 119.48, accuracy: 10 }, await selfie());
  expect('check-in di luar radius ditolak 422', far.status === 422 && far.body.distanceM > 150, far.body);

  const mock = await postAttendance(BASE, IN, logTok, { ...atSite, isMocked: true }, await selfie());
  expect('mock location ditolak 422', mock.status === 422);

  const inaccurate = await postAttendance(BASE, IN, logTok, { ...atSite, accuracy: 500 }, await selfie());
  expect('akurasi GPS buruk ditolak 422', inaccurate.status === 422);

  const outEarly = await postAttendance(BASE, OUT, logTok, atSite, await selfie());
  expect('check-out sebelum check-in ditolak 400', outEarly.status === 400);

  // ---- Selfie wajah
  const noConsent = await postAttendance(BASE, IN, logTok, atSite, await selfie());
  expect('tanpa persetujuan foto wajah ditolak (403 FACE_CONSENT_REQUIRED)', noConsent.status === 403 && noConsent.body.code === 'FACE_CONSENT_REQUIRED', noConsent.body);
  const cs = await call('GET', '/api/attendance/face-consent', { token: logTok });
  expect('teks persetujuan UU PDP tersedia (90 hari)', cs.body.required === true && /90 hari/.test(cs.body.text), cs.body);
  await consent(BASE, logTok);
  const noPhoto = await postAttendance(BASE, IN, logTok, atSite, null);
  expect('tanpa selfie ditolak (400 SELFIE_REQUIRED)', noPhoto.status === 400 && noPhoto.body.code === 'SELFIE_REQUIRED', noPhoto.body);
  const wall = await sharp({ create: { width: 600, height: 800, channels: 3, background: '#bbb' } }).jpeg().toBuffer();
  const noFace = await postAttendance(BASE, IN, logTok, atSite, wall);
  expect('foto tanpa wajah ditolak (422 FACE_REJECTED)', noFace.status === 422 && noFace.body.code === 'FACE_REJECTED', noFace.body);
  const one = await selfie();
  const meta = await sharp(one).metadata();
  const two = await sharp({ create: { width: meta.width * 2, height: meta.height, channels: 3, background: '#fff' } })
    .composite([{ input: one, left: 0, top: 0 }, { input: one, left: meta.width, top: 0 }]).jpeg().toBuffer();
  const group = await postAttendance(BASE, IN, logTok, atSite, two);
  expect('foto berisi 2 wajah ditolak (422)', group.status === 422 && group.body.faces === 2, group.body);

  // Upload tanpa jenis file (seperti dari aplikasi Flutter lama) tetap diterima bila isinya gambar;
  // file bukan gambar tetap ditolak.
  const notImg = new FormData();
  for (const [k, v] of Object.entries(atSite)) notImg.append(k, String(v));
  notImg.append('photo', new Blob([Buffer.from('bukan gambar')], { type: 'application/octet-stream' }), 'x.jpg');
  const ni = await fetch(`${BASE}${IN}`, { method: 'POST', headers: { Authorization: `Bearer ${logTok}` }, body: notImg });
  expect('file bukan gambar tanpa jenis file ditolak (400)', ni.status === 400);

  const ciPhoto = await selfie();
  const ci = await postAttendance(BASE, IN, logTok, { ...atSite, note: 'Masuk' }, ciPhoto);
  expect('check-in dengan selfie dalam radius 201', ci.status === 201 && ci.body.attendance.checkIn.distanceM < 150 && ci.body.attendance.checkIn.photoUrl, ci.body);
  const img = await fetch(BASE + ci.body.attendance.checkIn.photoUrl);
  expect('foto selfie tersimpan & bisa dibuka lewat URL bertanda tangan', img.status === 200);

  const ci2 = await postAttendance(BASE, IN, logTok, atSite, await selfie());
  expect('check-in kedua ditolak 409', ci2.status === 409);

  const today = await call('GET', '/api/attendance/today', { token: logTok });
  expect('status hari ini', today.status === 200 && today.body.attendance && !today.body.attendance.checkOut, today.body);

  const reuse = await postAttendance(BASE, OUT, logTok, atSite, ciPhoto);
  expect('foto check-in dipakai ulang untuk check-out ditolak (409 SELFIE_REUSED)', reuse.status === 409 && reuse.body.code === 'SELFIE_REUSED', reuse.body);
  const co = await postAttendance(BASE, OUT, logTok, { latitude: -5.0616, longitude: 119.4732, accuracy: 8 }, await selfie());
  expect('check-out dengan selfie 200', co.status === 200 && co.body.attendance.checkOut && co.body.attendance.checkOut.photoUrl, co.body);

  const hist = await call('GET', '/api/attendance/me', { token: logTok });
  expect('riwayat sendiri', hist.status === 200 && hist.body.attendance.length >= 1);

  const rep = await call('GET', '/api/attendance', { token: smTok });
  expect('site manager lihat laporan site-nya', rep.status === 200 && rep.body.attendance.every((a) => a.siteId === siteId) && rep.body.attendance.length >= 1, rep.body);
  expect('laporan atasan menampilkan selfie masuk & pulang', rep.body.attendance.some((a) => a.checkIn.photoUrl && a.checkOut?.photoUrl));

  const sum = await call('GET', '/api/attendance/summary', { token: adminTok });
  expect('ringkasan harian', sum.status === 200 && sum.body.present >= 1, sum.body);

  const csv = await fetch(`${BASE}/api/attendance/export.csv`, { headers: { Authorization: `Bearer ${adminTok}` } });
  const csvText = await csv.text();
  expect('export CSV', csv.status === 200 && csvText.includes('Jam Masuk'));

  // Nonaktifkan user -> token lama langsung tidak berlaku
  const deact = await call('PUT', `/api/users/${logi.body.user.id}`, { token: sa, body: { isActive: false } });
  expect('nonaktifkan user', deact.status === 200 && deact.body.user.isActive === false, deact.body);
  const revoked = await call('GET', '/api/auth/me', { token: logTok });
  expect('token user nonaktif dicabut (401)', revoked.status === 401);

  const self = await call('PUT', `/api/users/${login.body.user.id}`, { token: sa, body: { isActive: false } });
  expect('tidak bisa nonaktifkan diri sendiri (400)', self.status === 400);

  const noTok = await call('GET', '/api/attendance/today');
  expect('tanpa token 401', noTok.status === 401);

  console.log(failures ? `\n${failures} pengujian GAGAL` : '\nSemua pengujian lulus');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
