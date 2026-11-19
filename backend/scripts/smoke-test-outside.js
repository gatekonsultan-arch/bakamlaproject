'use strict';
/**
 * Uji absen di luar area + persetujuan PM / Site Manager terhadap API yang berjalan (gunakan DB uji!).
 *   API_URL=http://localhost:3000 SUPERADMIN_PASSWORD='...' TEST_SELFIE=/path/selfie.jpg node scripts/smoke-test-outside.js
 */
const { selfie, postAttendance, consent } = require('./lib/selfie');

const BASE = process.env.API_URL || 'http://localhost:3000';
let failures = 0;
async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
function expect(name, cond, info) {
  if (cond) console.log(`  OK   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 400) : ''); }
}

(async () => {
  const sfx = Date.now().toString(36);
  const sa = (await call('POST', '/api/auth/login', { body: { username: process.env.SUPERADMIN_USERNAME || 'superadmin', password: process.env.SUPERADMIN_PASSWORD } })).body.token;
  const site = (await call('POST', '/api/sites', { token: sa, body: { name: `Site Luar ${sfx}`, latitude: -3.3, longitude: 117.6, radiusM: 100 } })).body.site;
  const other = (await call('POST', '/api/sites', { token: sa, body: { name: `Site Luar Lain ${sfx}`, latitude: -3.5, longitude: 117.8, radiusM: 100 } })).body.site;
  const mk = async (role, siteId, tag = '') => {
    const u = `${role.toLowerCase()}_o${tag}${sfx}`;
    await call('POST', '/api/users', { token: sa, body: { username: u, fullName: `${role} ${tag}${sfx}`, password: 'Password123', role, siteId } });
    const t = (await call('POST', '/api/auth/login', { body: { username: u, password: 'Password123' } })).body.token;
    await consent(BASE, t);
    return t;
  };
  const staff = await mk('LOGISTIK', site.id);
  const staff2 = await mk('HSE_OFFICER', site.id);
  const sm = await mk('SITE_MANAGER', site.id);
  const smOther = await mk('SITE_MANAGER', other.id, 'x');
  const pm = await mk('PROJECT_MANAGER', null);

  const IN = '/api/attendance/check-in';
  const OUT = '/api/attendance/check-out';
  const atSite = { latitude: -3.3, longitude: 117.6, accuracy: 10 };
  const away = { latitude: -3.32, longitude: 117.61, accuracy: 10 }; // ±2,5 km

  // ---- Check-in di luar area
  const noReason = await postAttendance(BASE, IN, staff, away, await selfie());
  expect('di luar area tanpa keterangan: 422 OUTSIDE_AREA + info jarak', noReason.status === 422 && noReason.body.code === 'OUTSIDE_AREA'
    && noReason.body.distanceM > 2000 && noReason.body.radiusM === 100 && /keterangan/i.test(noReason.body.message), noReason.body);
  const short = await postAttendance(BASE, IN, staff, { ...away, outsideReason: 'rapat' }, await selfie());
  expect('keterangan terlalu pendek ditolak (422)', short.status === 422 && /minimal 10/.test(short.body.message), short.body);
  const ok = await postAttendance(BASE, IN, staff, { ...away, outsideReason: 'Rapat koordinasi di kantor Bakamla Balikpapan' }, await selfie());
  expect('check-in di luar area dengan keterangan diterima (201, menunggu persetujuan)', ok.status === 201
    && ok.body.attendance.approval.status === 'PENDING' && ok.body.attendance.checkIn.outside === true
    && /Menunggu persetujuan/.test(ok.body.message), ok.body);
  const attId = ok.body.attendance.id;

  // Staf lain absen normal di dalam area -> langsung diakui
  const normal = await postAttendance(BASE, IN, staff2, atSite, await selfie());
  expect('check-in di dalam area langsung diakui (APPROVED)', normal.status === 201 && normal.body.attendance.approval.status === 'APPROVED'
    && normal.body.attendance.checkIn.outside === false, normal.body);

  // ---- Belum diakui hadir sebelum disetujui
  let sum = (await call('GET', '/api/attendance/summary', { token: sm })).body;
  expect('rekap: yang menunggu persetujuan belum dihitung hadir', sum.present === 1 && sum.pending === 1, sum);

  // ---- Hak akses persetujuan
  expect('staf biasa tidak punya menu approval (403)', (await call('GET', '/api/attendance/approvals', { token: staff2 })).status === 403);
  const smList = (await call('GET', '/api/attendance/approvals', { token: sm })).body;
  const row = smList.attendance?.find((a) => a.id === attId);
  expect('Site Manager melihat absen luar area di lokasinya (+ keterangan, foto)', row && row.canDecide === true
    && row.checkIn.reason.includes('Bakamla') && row.checkIn.photoUrl && smList.pendingCount >= 1, smList);
  expect('absen normal tidak masuk daftar approval', !smList.attendance.some((a) => a.userId === normal.body.attendance.userId));
  const otherList = (await call('GET', '/api/attendance/approvals', { token: smOther })).body;
  expect('Site Manager lokasi lain tidak melihatnya', !otherList.attendance.some((a) => a.id === attId), otherList);
  const otherDecide = await call('POST', `/api/attendance/${attId}/decision`, { token: smOther, body: { decision: 'APPROVE' } });
  expect('Site Manager lokasi lain tidak bisa menyetujui (403)', otherDecide.status === 403, otherDecide.body);
  const rejNoNote = await call('POST', `/api/attendance/${attId}/decision`, { token: sm, body: { decision: 'REJECT' } });
  expect('tolak tanpa alasan ditolak (400)', rejNoNote.status === 400, rejNoNote.body);

  // ---- Site Manager menyetujui
  const appr = await call('POST', `/api/attendance/${attId}/decision`, { token: sm, body: { decision: 'APPROVE', note: 'Benar rapat di kantor Bakamla' } });
  expect('Site Manager menyetujui -> diakui hadir', appr.status === 200 && appr.body.attendance.approval.status === 'APPROVED'
    && appr.body.attendance.approval.byName && appr.body.attendance.approval.note, appr.body);
  const again = await call('POST', `/api/attendance/${attId}/decision`, { token: pm, body: { decision: 'REJECT', note: 'coba lagi' } });
  expect('keputusan ganda ditolak (409)', again.status === 409, again.body);
  sum = (await call('GET', '/api/attendance/summary', { token: sm })).body;
  expect('rekap: setelah disetujui dihitung hadir', sum.present === 2 && sum.pending === 0, sum);

  // ---- Check-out di luar area -> perlu persetujuan lagi; PM menolak
  const outNo = await postAttendance(BASE, OUT, staff, away, await selfie());
  expect('check-out di luar area tanpa keterangan: 422 OUTSIDE_AREA', outNo.status === 422 && outNo.body.code === 'OUTSIDE_AREA', outNo.body);
  const out = await postAttendance(BASE, OUT, staff, { ...away, outsideReason: 'Pulang langsung dari kantor Bakamla' }, await selfie());
  expect('check-out di luar area -> kembali menunggu persetujuan', out.status === 200 && out.body.attendance.approval.status === 'PENDING'
    && out.body.attendance.checkOut.outside === true && out.body.attendance.approval.byName === null, out.body);
  const rej = await call('POST', `/api/attendance/${attId}/decision`, { token: pm, body: { decision: 'REJECT', note: 'Tidak ada surat tugas' } });
  expect('Project Manager menolak (lokasi mana pun)', rej.status === 200 && rej.body.attendance.approval.status === 'REJECTED', rej.body);
  sum = (await call('GET', '/api/attendance/summary', { token: sm })).body;
  expect('rekap: yang ditolak tidak dihitung hadir & masuk daftar belum absen', sum.present === 1 && sum.rejected === 1
    && sum.absent.some((u) => u.fullName.startsWith('LOGISTIK')), sum);
  const mine = (await call('GET', '/api/attendance/today', { token: staff })).body.attendance;
  expect('karyawan melihat status ditolak + alasannya', mine.approval.status === 'REJECTED' && mine.approval.note === 'Tidak ada surat tugas', mine.approval);
  const rejList = (await call('GET', '/api/attendance/approvals?status=REJECTED', { token: pm })).body;
  expect('daftar "Ditolak" memuat absensi tersebut', rejList.attendance.some((a) => a.id === attId && a.canDecide === false), rejList);

  // ---- Site Manager sendiri absen di luar area: tidak bisa menyetujui diri sendiri; SM tak bisa memutus absensi PM
  const smIn = await postAttendance(BASE, IN, sm, { ...away, outsideReason: 'Survey material di toko bangunan' }, await selfie());
  expect('Site Manager check-in di luar area (menunggu)', smIn.status === 201 && smIn.body.attendance.approval.status === 'PENDING', smIn.body);
  const self = await call('POST', `/api/attendance/${smIn.body.attendance.id}/decision`, { token: sm, body: { decision: 'APPROVE' } });
  expect('tidak bisa menyetujui absensi sendiri (403)', self.status === 403, self.body);
  const pmIn = await postAttendance(BASE, IN, pm, { ...away, outsideReason: 'Rapat dengan owner di kota' }, await selfie());
  expect('Project Manager check-in di luar area (menunggu)', pmIn.status === 201, pmIn.body);
  const smOnPm = await call('POST', `/api/attendance/${pmIn.body.attendance.id}/decision`, { token: sm, body: { decision: 'APPROVE' } });
  expect('Site Manager tidak bisa memutus absensi Project Manager (403)', smOnPm.status === 403, smOnPm.body);
  const pmSees = (await call('GET', '/api/attendance/approvals', { token: pm })).body;
  expect('PM melihat absensi Site Manager untuk disetujui', pmSees.attendance.some((a) => a.id === smIn.body.attendance.id && a.canDecide), pmSees);
  const saOnPm = await call('POST', `/api/attendance/${pmIn.body.attendance.id}/decision`, { token: sa, body: { decision: 'APPROVE' } });
  expect('Superadmin dapat menyetujui absensi PM', saOnPm.status === 200, saOnPm.body);

  // ---- Ekspor CSV memuat status & keterangan
  const csv = await fetch(`${BASE}/api/attendance/export.csv?siteId=${site.id}`, { headers: { Authorization: `Bearer ${pm}` } }).then((r) => r.text());
  expect('CSV memuat kolom status & keterangan luar area', /Status/.test(csv) && /Ditolak/.test(csv) && /Rapat koordinasi/.test(csv), csv.slice(0, 300));

  console.log(failures ? `\n${failures} uji GAGAL` : '\nSemua uji absen luar area lulus');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
