'use strict';
/**
 * Uji alur Tenaga Kerja & Rekap Upah terhadap API yang berjalan (gunakan DB uji!).
 *   API_URL=http://localhost:3000 SUPERADMIN_PASSWORD='...' node scripts/smoke-test-workers.js
 * Catatan: memakai pekan berjalan; hari absen = Senin pekan ini s/d kemarin/hari ini (bukan Minggu).
 */
const sharp = require('sharp');
const BASE = process.env.API_URL || 'http://localhost:3000';
let failures = 0;
async function call(method, path, { token, body, form } = {}) {
  const res = await fetch(BASE + path, { method, headers: { ...(form ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: form || (body ? JSON.stringify(body) : undefined) });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
function expect(name, cond, info) {
  if (cond) console.log(`  OK   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 400) : ''); }
}
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Jakarta' }).format(d);
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (s) => { const x = new Date(`${s}T00:00:00Z`).getUTCDay(); return x === 0 ? 7 : x; };

(async () => {
  const sfx = Date.now().toString(36);
  const today = ymd(new Date());
  // Pekan uji: bila hari ini Minggu pakai pekan yang baru lewat; selain itu pekan berjalan s/d hari ini.
  const ref = dow(today) === 7 ? addDays(today, -1) : today;
  const monday = addDays(ref, 1 - dow(ref));
  const days = []; for (let d = monday; d <= ref; d = addDays(d, 1)) days.push(d);
  console.log(`Pekan uji ${monday} (${days.length} hari kerja s/d ${ref})`);

  const sa = (await call('POST', '/api/auth/login', { body: { username: process.env.SUPERADMIN_USERNAME || 'superadmin', password: process.env.SUPERADMIN_PASSWORD } })).body.token;
  const site = (await call('POST', '/api/sites', { token: sa, body: { name: `Site Upah ${sfx}`, latitude: -5.2, longitude: 119.4, radiusM: 100 } })).body.site;
  const other = (await call('POST', '/api/sites', { token: sa, body: { name: `Site Lain ${sfx}`, latitude: -5.3, longitude: 119.5, radiusM: 100 } })).body.site;
  const mk = async (role, siteId) => {
    const u = `${role.toLowerCase()}_w${sfx}`;
    await call('POST', '/api/users', { token: sa, body: { username: u, fullName: `${role} ${sfx}`, password: 'Password123', role, siteId } });
    return (await call('POST', '/api/auth/login', { body: { username: u, password: 'Password123' } })).body.token;
  };
  const sm = await mk('SITE_MANAGER', site.id);
  const pm = await mk('PROJECT_MANAGER', null);
  const lg = await mk('LOGISTIK', site.id);
  const ad = await mk('ADMIN', null);
  const at = { latitude: -5.2001, longitude: 119.4001, accuracy: 10 };

  console.log('\n-- Data pekerja');
  const W = {};
  for (const [k, name, category, rate, ot] of [['m', 'Pak Darman', 'MANDOR', 200000, 30000], ['t', 'Udin', 'TUKANG', 150000, 20000], ['b', 'Joko', 'BURUH', 120000, 15000]]) {
    const r = await call('POST', '/api/workers', { token: sm, body: { siteId: site.id, name, category, trade: category === 'TUKANG' ? 'Tukang Batu' : null, dailyRate: rate, overtimeRate: ot } });
    expect(`SM tambah ${category} ${name}`, r.status === 201, r.body); W[k] = r.body.worker;
  }
  const otherSite = await call('POST', '/api/workers', { token: sm, body: { siteId: other.id, name: 'X', category: 'BURUH', dailyRate: 1 } });
  expect('SM tidak bisa tambah pekerja di lokasi lain (403)', otherSite.status === 403);
  expect('Logistik tidak bisa melihat data upah (403)', (await call('GET', '/api/workers', { token: lg })).status === 403);
  const smList = await call('GET', '/api/workers', { token: sm });
  expect('SM melihat 3 pekerja lokasinya', smList.body.workers.length === 3, smList.body);

  console.log('\n-- Absen harian');
  const entries = (st) => [{ workerId: W.m.id, status: 'FULL', overtimeHours: 1 }, { workerId: W.t.id, status: st, overtimeHours: 0 }, { workerId: W.b.id, status: 'FULL', overtimeHours: 2 }];
  const far = await call('PUT', '/api/workers/attendance', { token: sm, body: { siteId: site.id, date: ref, latitude: -5.25, longitude: 119.45, accuracy: 10, entries: entries('FULL') } });
  expect('absen di luar lokasi proyek ditolak (422)', far.status === 422, far.body);
  const pmAbs = await call('PUT', '/api/workers/attendance', { token: pm, body: { siteId: site.id, date: ref, ...at, entries: entries('FULL') } });
  expect('PM tidak mengisi absen tenaga kerja (403)', pmAbs.status === 403);
  const sunday = addDays(monday, 6);
  const sun = await call('PUT', '/api/workers/attendance', { token: sm, body: { siteId: site.id, date: sunday <= today ? sunday : addDays(monday, -1), ...at, entries: entries('FULL') } });
  expect('hari Minggu ditolak (400)', sun.status === 400, sun.body);
  const fut = await call('PUT', '/api/workers/attendance', { token: sm, body: { siteId: site.id, date: addDays(today, 1), ...at, entries: entries('FULL') } });
  expect('tanggal mendatang ditolak (400)', fut.status === 400);

  // Hari ke-1: tukang setengah hari; hari ke-2 (bila ada): tukang tidak masuk; sisanya penuh.
  for (const [i, d] of days.entries()) {
    const st = i === 0 ? 'HALF' : i === 1 ? 'ABSENT' : 'FULL';
    const r = await call('PUT', '/api/workers/attendance', { token: sm, body: { siteId: site.id, date: d, ...at, entries: entries(st) } });
    if (r.status !== 200) expect(`absen ${d}`, false, r.body);
  }
  expect(`absen ${days.length} hari tersimpan`, true);
  const sheet = await call('GET', `/api/workers/attendance?siteId=${site.id}&date=${days[0]}`, { token: sm });
  expect('lembar absen terbaca (status & lembur)', sheet.body.entries.find((e) => e.workerId === W.t.id).status === 'HALF' && sheet.body.sheet, sheet.body);
  const fd = new FormData();
  fd.append('siteId', String(site.id)); fd.append('date', days[0]);
  fd.append('photo', new Blob([await sharp({ create: { width: 400, height: 300, channels: 3, background: '#557' } }).jpeg().toBuffer()], { type: 'image/jpeg' }), 'apel.jpg');
  const ph = await call('POST', '/api/workers/attendance/photo', { token: sm, form: fd });
  expect('unggah foto apel pagi', ph.status === 200 && ph.body.photoUrl, ph.body);

  console.log('\n-- Kasbon & rekap');
  const adv = await call('POST', '/api/workers/advances', { token: sm, body: { workerId: W.b.id, date: days[0], amount: 100000, note: 'Kasbon' } });
  expect('SM catat kasbon Rp100.000', adv.status === 201, adv.body);

  // Upah naik setelah absen dicatat -> hari yang sudah dicatat tetap pakai upah lama
  await call('PUT', `/api/workers/${W.t.id}`, { token: pm, body: { dailyRate: 175000 } });

  const n = days.length;
  const tFactor = (n >= 1 ? 0.5 : 0) + Math.max(0, n - 2);
  const exp = {
    m: n * 200000 + n * 30000,
    t: tFactor * 150000,
    b: n * 120000 + n * 2 * 15000 - 100000,
  };
  const pr = await call('GET', `/api/workers/payroll?siteId=${site.id}&weekStart=${monday}`, { token: pm });
  const row = (k) => pr.body.recap.rows.find((r) => r.workerId === W[k].id);
  expect(`mandor: ${n} hari + lembur = ${exp.m}`, row('m').net === exp.m, row('m'));
  expect(`tukang: ${tFactor} hari kerja x 150.000 (upah lama) = ${exp.t}`, row('t').net === exp.t && row('t').workDays === tFactor, row('t'));
  expect(`buruh: upah + lembur - kasbon = ${exp.b}`, row('b').net === exp.b, row('b'));
  expect('total keseluruhan benar', pr.body.recap.totals.net === exp.m + exp.t + exp.b, pr.body.recap.totals);
  expect('urutan Mandor, Tukang, Buruh', pr.body.recap.rows.map((r) => r.category).join() === 'MANDOR,TUKANG,BURUH');

  console.log('\n-- Pengajuan & persetujuan');
  const noSig = await call('POST', '/api/workers/payroll/submit', { token: sm, body: { siteId: site.id, weekStart: monday } });
  expect('ajukan tanpa tanda tangan ditolak (422)', noSig.status === 422 && noSig.body.code === 'SIGNATURE_REQUIRED');
  const sigPng = await sharp({ create: { width: 300, height: 100, channels: 3, background: '#fff' } }).composite([{ input: Buffer.from('<svg width="300" height="100"><path d="M20 70 Q 100 10 160 60 T 280 40" stroke="#123" stroke-width="5" fill="none"/></svg>') }]).png().toBuffer();
  for (const tok of [sm, pm]) { const f = new FormData(); f.append('file', new Blob([sigPng], { type: 'image/png' }), 's.png'); await call('POST', '/api/hse-reports/me/signature', { token: tok, form: f }); }
  const pmSubmit = await call('POST', '/api/workers/payroll/submit', { token: pm, body: { siteId: site.id, weekStart: monday } });
  expect('PM tidak mengajukan rekap (403)', pmSubmit.status === 403);
  const sub = await call('POST', '/api/workers/payroll/submit', { token: sm, body: { siteId: site.id, weekStart: monday } });
  expect('SM ajukan rekap', sub.status === 200, sub.body);
  const locked = await call('PUT', '/api/workers/attendance', { token: sm, body: { siteId: site.id, date: days[0], ...at, entries: entries('FULL') } });
  expect('absen terkunci setelah diajukan (409)', locked.status === 409, locked.body);
  const advLocked = await call('POST', '/api/workers/advances', { token: sm, body: { workerId: W.b.id, date: days[0], amount: 5000 } });
  expect('kasbon terkunci setelah diajukan (409)', advLocked.status === 409);
  const ret = await call('POST', '/api/workers/payroll/return', { token: pm, body: { siteId: site.id, weekStart: monday, note: 'Cek lembur buruh' } });
  expect('PM kembalikan untuk perbaikan', ret.status === 200);
  const fix = await call('PUT', '/api/workers/attendance', { token: sm, body: { siteId: site.id, date: days[0], ...at, entries: entries('HALF') } });
  expect('setelah dikembalikan, absen bisa diperbaiki', fix.status === 200, fix.body);
  const fixed = await call('GET', `/api/workers/payroll?siteId=${site.id}&weekStart=${monday}`, { token: pm });
  const ft = fixed.body.recap.rows.find((r) => r.workerId === W.t.id);
  expect('perbaikan status tidak mengubah tarif hari itu (tetap upah lama)', ft.net === exp.t && ft.ratesUsed.join() === '150000', ft);
  await call('POST', '/api/workers/payroll/submit', { token: sm, body: { siteId: site.id, weekStart: monday } });
  const apv = await call('POST', '/api/workers/payroll/approve', { token: pm, body: { siteId: site.id, weekStart: monday } });
  expect('PM setujui rekap (terkunci)', apv.status === 200, apv.body);
  // Upah diubah lagi setelah disetujui -> rekap tidak berubah (snapshot)
  await call('PUT', `/api/workers/${W.m.id}`, { token: pm, body: { dailyRate: 999999 } });
  const after = await call('GET', `/api/workers/payroll?siteId=${site.id}&weekStart=${monday}`, { token: pm });
  expect('rekap disetujui tidak berubah walau upah diubah', after.body.status === 'APPROVED' && after.body.recap.rows[0].net === exp.m, after.body.recap.rows[0]);
  const paid = await call('POST', '/api/workers/payroll/paid', { token: ad, body: { siteId: site.id, weekStart: monday } });
  expect('Admin tandai sudah dibayar', paid.status === 200, paid.body);

  const link = await call('POST', '/api/workers/payroll/link', { token: pm, body: { siteId: site.id, weekStart: monday } });
  const html = await (await fetch(BASE + link.body.url)).text();
  expect('lembar cetak rekap berisi nama & total', html.includes('REKAP UPAH TENAGA KERJA HARIAN') && html.includes('Pak Darman') && html.includes('Sudah dibayar'));
  expect('tanda tangan SM & PM di lembar cetak', (html.match(/\/api\/files\/signatures\//g) || []).length === 2);
  const csvLink = await call('POST', '/api/workers/payroll/link', { token: pm, body: { siteId: site.id, weekStart: monday, format: 'csv' } });
  const csv = await (await fetch(BASE + csvLink.body.url)).text();
  expect('ekspor CSV (Excel)', csv.includes('Nama,Kategori') && csv.includes('TOTAL'));
  if (process.env.PRINT_OUT) require('fs').writeFileSync(process.env.PRINT_OUT, BASE + link.body.url);

  console.log(failures ? `\n${failures} pengujian GAGAL` : '\nSemua pengujian lulus');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
