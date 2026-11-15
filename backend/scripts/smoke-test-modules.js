'use strict';
/**
 * Uji alur modul Material & Laporan K3 terhadap API yang berjalan (gunakan DB uji!).
 *   API_URL=http://localhost:3000 SUPERADMIN_PASSWORD='...' node scripts/smoke-test-modules.js
 */
const sharp = require('sharp');
const { selfie, postAttendance, consent } = require('./lib/selfie');

const BASE = process.env.API_URL || 'http://localhost:3000';
let failures = 0;

async function call(method, path, { token, body, form } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(form ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
function expect(name, cond, info) {
  if (cond) console.log(`  OK   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 400) : ''); }
}

(async () => {
  const sfx = Date.now().toString(36);
  const sa = (await call('POST', '/api/auth/login', { body: { username: process.env.SUPERADMIN_USERNAME || 'superadmin', password: process.env.SUPERADMIN_PASSWORD } })).body.token;
  expect('login superadmin', !!sa);

  const site = (await call('POST', '/api/sites', { token: sa, body: { name: `Site Modul ${sfx}`, latitude: -5.06, longitude: 119.47, radiusM: 200 } })).body.site;
  const mk = async (role) => {
    const u = `${role.toLowerCase()}_${sfx}`;
    const r = await call('POST', '/api/users', { token: sa, body: { username: u, fullName: `${role} ${sfx}`, password: 'Password123', role, siteId: site.id } });
    expect(`buat user ${role}`, r.status === 201, r.body);
    return (await call('POST', '/api/auth/login', { body: { username: u, password: 'Password123' } })).body.token;
  };
  const pm = await mk('PROJECT_MANAGER');
  const sm = await mk('SITE_MANAGER');
  const lg = await mk('LOGISTIK');
  const ho = await mk('HSE_OFFICER');
  const hm = await mk('HSE_MANAGER');

  console.log('\n-- Material');
  const cat = await call('POST', '/api/materials/catalog', { token: pm, body: { code: `SEM-${sfx}`, name: 'Semen Portland 50kg', unit: 'sak', category: 'Struktur' } });
  expect('PM tambah katalog material', cat.status === 201, cat.body);
  const noCat = await call('POST', '/api/materials/catalog', { token: lg, body: { code: `X-${sfx}`, name: 'X', unit: 'pcs' } });
  expect('Logistik tidak boleh tambah katalog (403)', noCat.status === 403);

  const plan = await call('POST', '/api/materials/plans', { token: sm, body: { siteId: site.id, materialId: cat.body.material.id, plannedQty: 100, minStock: 10 } });
  expect('SM input kebutuhan 100 sak, min stok 10', plan.status === 201 && plan.body.plan.level === 'GREEN', plan.body);
  const smId = plan.body.plan.id;
  const dupPlan = await call('POST', '/api/materials/plans', { token: pm, body: { siteId: site.id, materialId: cat.body.material.id, plannedQty: 5 } });
  expect('kebutuhan ganda ditolak (409)', dupPlan.status === 409);

  const hseView = await call('GET', '/api/materials/plans', { token: ho });
  expect('HSE Officer tidak punya akses material (403)', hseView.status === 403);

  const pr = await call('POST', '/api/purchase-requests', { token: lg, body: { siteId: site.id, note: 'Untuk pondasi', items: [{ siteMaterialId: smId, qty: 85, unitPrice: 65000 }] } });
  expect('Logistik ajukan pembelian 85 sak', pr.status === 201 && /^PR-\d{8}-\d{4}$/.test(pr.body.request.requestNo), pr.body);
  expect('proyeksi: 85% -> kuning untuk PM', pr.body.items?.[0]?.projection?.level === 'YELLOW', pr.body.items);
  const prId = pr.body.request.id;

  const smApprove = await call('POST', `/api/purchase-requests/${prId}/approve`, { token: sm, body: {} });
  expect('Site Manager tidak boleh approve (403)', smApprove.status === 403);
  const orderEarly = await call('POST', `/api/purchase-requests/${prId}/order`, { token: lg, body: { supplier: 'PT Semen' } });
  expect('pesan sebelum approve ditolak (409)', orderEarly.status === 409);
  const rejectNoNote = await call('POST', `/api/purchase-requests/${prId}/reject`, { token: pm, body: {} });
  expect('tolak tanpa alasan ditolak (400)', rejectNoNote.status === 400);
  const appr = await call('POST', `/api/purchase-requests/${prId}/approve`, { token: pm, body: { note: 'OK' } });
  expect('PM approve', appr.status === 200, appr.body);
  const appr2 = await call('POST', `/api/purchase-requests/${prId}/approve`, { token: pm, body: {} });
  expect('approve dua kali ditolak (409)', appr2.status === 409);

  let p = (await call('GET', `/api/materials/plans/${smId}`, { token: pm })).body.plan;
  expect('setelah approve: pengadaan 85% -> KUNING', p.level === 'YELLOW' && p.onOrder === 85, p);

  const ord = await call('POST', `/api/purchase-requests/${prId}/order`, { token: lg, body: { supplier: 'PT Semen Tonasa', poNumber: 'PO-001' } });
  expect('Logistik catat pemesanan', ord.status === 200, ord.body);
  const det = (await call('GET', `/api/purchase-requests/${prId}`, { token: lg })).body;
  const itemId = det.items[0].id;
  const over = await call('POST', `/api/purchase-requests/${prId}/receive`, { token: lg, body: { items: [{ itemId, qty: 90 }] } });
  expect('terima melebihi pesanan ditolak (422)', over.status === 422);
  const rc1 = await call('POST', `/api/purchase-requests/${prId}/receive`, { token: lg, body: { items: [{ itemId, qty: 50 }] } });
  expect('terima sebagian -> PARTIAL', rc1.body.status === 'PARTIAL', rc1.body);
  const rc2 = await call('POST', `/api/purchase-requests/${prId}/receive`, { token: lg, body: { items: [{ itemId, qty: 35 }] } });
  expect('terima sisa -> RECEIVED', rc2.body.status === 'RECEIVED', rc2.body);

  const use1 = await call('POST', '/api/materials/movements', { token: lg, body: { siteMaterialId: smId, type: 'OUT', qty: 74, note: 'Cor pondasi' } });
  expect('catat pemakaian 74 sak (stok 11 -> mendekati min 10)', use1.status === 201 && use1.body.plan.stock === 11, use1.body);
  expect('penanda stok KUNING', use1.body.plan.flags.some((f) => f.type === 'STOCK' && f.level === 'YELLOW'), use1.body.plan.flags);
  const use2 = await call('POST', '/api/materials/movements', { token: lg, body: { siteMaterialId: smId, type: 'OUT', qty: 2 } });
  expect('stok 9 <= min 10 -> MERAH', use2.body.plan.level === 'RED' && use2.body.plan.flags.some((f) => f.type === 'STOCK' && f.level === 'RED'), use2.body.plan);
  const tooMuch = await call('POST', '/api/materials/movements', { token: lg, body: { siteMaterialId: smId, type: 'OUT', qty: 50 } });
  expect('pemakaian melebihi stok ditolak (422)', tooMuch.status === 422);
  const adjNoNote = await call('POST', '/api/materials/movements', { token: lg, body: { siteMaterialId: smId, type: 'ADJ', qty: -1 } });
  expect('penyesuaian tanpa keterangan ditolak (400)', adjNoNote.status === 400);

  const pr2 = await call('POST', '/api/purchase-requests', { token: lg, body: { siteId: site.id, items: [{ siteMaterialId: smId, qty: 30 }] } });
  expect('PR kedua: proyeksi 115% -> MERAH (melebihi kebutuhan)', pr2.body.items?.[0]?.projection?.level === 'RED', pr2.body.items);
  await call('POST', `/api/purchase-requests/${pr2.body.request.id}/approve`, { token: pm, body: {} });
  p = (await call('GET', `/api/materials/plans/${smId}`, { token: pm })).body.plan;
  expect('setelah disetujui: PLAN_PROCURED MERAH', p.flags.some((f) => f.type === 'PLAN_PROCURED' && f.level === 'RED'), p.flags);
  const alerts = (await call('GET', '/api/materials/alerts', { token: pm })).body;
  expect('dashboard penanda berisi material merah', alerts.counts.RED >= 1 && alerts.alerts[0].level === 'RED', alerts.counts);
  const cancel = await call('POST', `/api/purchase-requests/${pr2.body.request.id}/cancel`, { token: lg });
  expect('pembuat bisa batalkan PR yang disetujui', cancel.status === 200, cancel.body);

  console.log('\n-- Laporan Harian K3');
  // Absen HSE Officer di lokasi -> otomatis jadi anggota tim laporan
  await consent(BASE, ho);
  const hoIn = await postAttendance(BASE, '/api/attendance/check-in', ho, { latitude: -5.06, longitude: 119.47, accuracy: 10 }, await selfie());
  expect('HSE Officer check-in (selfie)', hoIn.status === 201, hoIn.body);
  const fresh = (await call('GET', `/api/hse-reports/settings/${site.id}`, { token: hm })).body.settings;
  expect('lokasi baru otomatis memakai logo bawaan PRIMA (kiri) & SRT (kanan)',
    fresh.imgUrl.logoL === '/api/files/default/logo-prima.png' && fresh.imgUrl.logoR === '/api/files/default/logo-srt.png'
    && fresh.imgDefault.logoL && fresh.con === 'PT Prima Integra Utama', fresh.imgUrl);
  for (const u of [fresh.imgUrl.logoL, fresh.imgUrl.logoR]) {
    const r = await fetch(BASE + u);
    expect(`logo bawaan bisa dibuka (${u.split('/').pop()})`, r.status === 200 && (r.headers.get('content-type') || '').includes('image/png'));
  }
  expect('nama file lain di folder logo bawaan ditolak (404)', (await fetch(`${BASE}/api/files/default/..%2F..%2Fpackage.json`)).status === 404);
  const sett = await call('PUT', `/api/hse-reports/settings/${site.id}`, { token: hm, body: { con: 'PT Kontraktor Uji', loc: 'Site Uji, Makassar', start: '2026-11-01', pm: 'Nama PM', members: [['Operator Satu', 'Heavy Equipment Operator']] } });
  expect('HSE Manager atur pengaturan laporan lokasi', sett.status === 200, sett.body);
  const noRep = await call('POST', '/api/hse-reports', { token: lg, body: { siteId: site.id } });
  expect('Logistik tidak bisa buat laporan K3 (403)', noRep.status === 403);
  const rep = await call('POST', '/api/hse-reports', { token: ho, body: { siteId: site.id } });
  expect('HSE Officer buat laporan', rep.status === 201, rep.body);
  const rid = rep.body.id;
  const dupRep = await call('POST', '/api/hse-reports', { token: ho, body: { siteId: site.id } });
  expect('laporan ganda (lokasi+tanggal sama) ditolak 409', dupRep.status === 409);

  const jpg = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#4a7' } }).jpeg().withMetadata({ exif: { IFD0: { DateTime: '2026:11:15 09:30:00' } } }).toBuffer();
  const fd = new FormData();
  fd.append('photos', new Blob([jpg], { type: 'image/jpeg' }), 'galian.jpg');
  fd.append('photos', new Blob([jpg], { type: 'image/jpeg' }), 'tbm.jpg');
  fd.append('takenTime', '10:15'); fd.append('takenTime', '08:05');
  const up = await call('POST', `/api/hse-reports/${rid}/photos`, { token: ho, form: fd });
  expect('upload 2 foto', up.status === 201 && up.body.photos.length === 2, up.body);
  const bad = new FormData();
  bad.append('photos', new Blob([Buffer.from('<?php echo 1; ?>')], { type: 'image/jpeg' }), 'x.jpg');
  const badUp = await call('POST', `/api/hse-reports/${rid}/photos`, { token: ho, form: bad });
  expect('file palsu (bukan gambar) ditolak 400', badUp.status === 400, badUp.body);

  const photo = up.body.photos[0];
  const img = await fetch(BASE + photo.url);
  expect('foto bisa dibuka lewat URL bertanda tangan', img.status === 200 && (img.headers.get('content-type') || '').includes('image'));
  const noTok = await fetch(BASE + photo.url.replace(/\?t=.*/, '?t=palsu'));
  expect('foto tanpa token valid ditolak 401', noTok.status === 401);
  await call('PUT', `/api/hse-reports/${rid}/photos/${photo.id}`, { token: ho, body: { activityKey: 'excav', caption: 'EXCAVATION WORKS', sky: 'S' } });

  const meta = (await call('GET', '/api/hse-reports/meta', { token: ho })).body;
  const ex = meta.activities.excav;
  const save = await call('PUT', `/api/hse-reports/${rid}`, { token: ho, body: {
    startTime: '08:00', finishTime: '17:00',
    content: {
      activities: [
        { key: 'tbm', time: '08:00', caption: 'TOOLBOX MEETING / SAFETY BRIEFING', work: 'Safety briefing before work', obs: 'Toolbox Meeting', heavy: false, hse: false },
        { key: 'excav', time: '10:15', caption: ex.c, work: ex.w, obs: ex.o, heavy: true, hse: false },
      ],
      weather: { 8: 'S', 9: 'S', 10: 'C', 11: 'C', 12: 'L', 13: 'S', 14: 'S', 15: 'S', 16: 'S' },
      weatherPhotos: { mid: photo.id, aft: null },
    } } });
  expect('simpan isi laporan', save.status === 200, save.body);
  const badTime = await call('PUT', `/api/hse-reports/${rid}`, { token: ho, body: { startTime: '18:00', finishTime: '17:00' } });
  expect('jam selesai sebelum mulai ditolak 400', badTime.status === 400);

  const full = (await call('GET', `/api/hse-reports/${rid}`, { token: ho })).body;
  expect('anggota tim otomatis dari absensi + pengaturan', full.members.some((m) => m.source === 'attendance') && full.members.some((m) => m.name === 'Operator Satu'), full.members);
  expect('nomor laporan otomatis dari format', /^\d{3}\/HSE\.LH\/[IVX]+\/\d{4}$/.test(full.report.reportNo), full.report.reportNo);

  // Tanda tangan digital wajib
  const noSig = await call('POST', `/api/hse-reports/${rid}/submit`, { token: ho });
  expect('kirim tanpa tanda tangan ditolak (422 SIGNATURE_REQUIRED)', noSig.status === 422 && noSig.body.code === 'SIGNATURE_REQUIRED', noSig.body);
  // Foto tanda tangan di kertas putih -> latar dibuat transparan
  const sigJpg = await sharp({ create: { width: 600, height: 200, channels: 3, background: '#f4f4f0' } })
    .composite([{ input: Buffer.from('<svg width="600" height="200"><path d="M40 150 C 120 20, 200 180, 300 80 S 480 60, 560 140" stroke="#102a6b" stroke-width="8" fill="none"/></svg>') }])
    .jpeg().toBuffer();
  const uploadSig = async (token) => {
    const f = new FormData();
    f.append('file', new Blob([sigJpg], { type: 'image/jpeg' }), 'ttd.jpg');
    return call('POST', '/api/hse-reports/me/signature', { token, form: f });
  };
  const blank = new FormData();
  blank.append('file', new Blob([await sharp({ create: { width: 300, height: 100, channels: 3, background: '#fff' } }).png().toBuffer()], { type: 'image/png' }), 'kosong.png');
  const blankUp = await call('POST', '/api/hse-reports/me/signature', { token: ho, form: blank });
  expect('tanda tangan kosong (kertas putih) ditolak 400', blankUp.status === 400, blankUp.body);
  const s1 = await uploadSig(ho);
  expect('HSE Officer unggah tanda tangan', s1.status === 200 && s1.body.url, s1.body);
  const sigImg = await fetch(BASE + s1.body.url);
  const sigMeta = await sharp(Buffer.from(await sigImg.arrayBuffer())).metadata();
  const sigStats = await sharp(Buffer.from(await (await fetch(BASE + s1.body.url)).arrayBuffer())).stats();
  expect('latar tanda tangan transparan (PNG ber-alpha)', sigMeta.format === 'png' && sigMeta.hasAlpha && sigStats.channels[3].min === 0, sigMeta);
  await uploadSig(sm);

  const ackEarly = await call('POST', `/api/hse-reports/${rid}/acknowledge`, { token: sm });
  expect('diketahui sebelum dikirim ditolak 403', ackEarly.status === 403);
  const sub = await call('POST', `/api/hse-reports/${rid}/submit`, { token: ho });
  expect('HSE Officer kirim laporan', sub.status === 200, sub.body);
  const editLocked = await call('PUT', `/api/hse-reports/${rid}`, { token: ho, body: { category: 'X' } });
  expect('laporan terkunci setelah dikirim (403)', editLocked.status === 403);
  const apprEarly = await call('POST', `/api/hse-reports/${rid}/approve`, { token: hm });
  expect('HSE Manager belum bisa approve sebelum diketahui PIC (403)', apprEarly.status === 403);
  const ret = await call('POST', `/api/hse-reports/${rid}/return`, { token: sm, body: { note: 'Tambahkan foto cuaca sore' } });
  expect('Site Manager kembalikan untuk revisi', ret.status === 200, ret.body);
  const sub2 = await call('POST', `/api/hse-reports/${rid}/submit`, { token: ho });
  expect('kirim ulang setelah revisi', sub2.status === 200);
  const ack = await call('POST', `/api/hse-reports/${rid}/acknowledge`, { token: sm });
  expect('Site Manager (PIC Site) mengetahui', ack.status === 200, ack.body);
  const apNoSig = await call('POST', `/api/hse-reports/${rid}/approve`, { token: hm });
  expect('HSE Manager tanpa tanda tangan tidak bisa approve (422)', apNoSig.status === 422 && apNoSig.body.code === 'SIGNATURE_REQUIRED');
  await uploadSig(hm);
  const ap = await call('POST', `/api/hse-reports/${rid}/approve`, { token: hm });
  expect('HSE Manager menyetujui', ap.status === 200, ap.body);
  const signedRep = (await call('GET', `/api/hse-reports/${rid}`, { token: hm })).body;
  const frozen = signedRep.signatures.approved.split('?')[0];
  expect('tanda tangan tersimpan pada laporan (3 penanda tangan)', ['prepared', 'acknowledged', 'approved'].every((k) => signedRep.signatures[k]), signedRep.signatures);
  await uploadSig(hm); // ganti tanda tangan setelah approve
  const after = (await call('GET', `/api/hse-reports/${rid}`, { token: hm })).body;
  expect('ganti tanda tangan tidak mengubah laporan yang sudah disetujui', after.signatures.approved.split('?')[0] === frozen);

  // Logo perusahaan
  const logo = await sharp({ create: { width: 400, height: 160, channels: 4, background: '#1e5aa8' } }).png().toBuffer();
  const lf = new FormData();
  lf.append('file', new Blob([logo], { type: 'image/png' }), 'logo.png');
  const lup = await call('POST', `/api/hse-reports/settings/${site.id}/image/logoL`, { token: hm, form: lf });
  expect('unggah logo kiri', lup.status === 200 && lup.body.settings.imgUrl.logoL, lup.body);

  const link = await call('POST', `/api/hse-reports/${rid}/print-link`, { token: ho, body: { lang: 'en' } });
  const html = await (await fetch(BASE + link.body.url)).text();
  expect('dokumen cetak berisi bagian A-J', ['A. PROJECT INFORMATION', 'E. WORK ACTIVITIES', 'F. INCIDENT', 'G. CUMULATIVE HSE STATISTICS', 'J. APPROVAL', 'EXCAVATION WORKS', 'WEATHER MONITORING'].every((s) => html.includes(s)));
  expect('dokumen disetujui tanpa watermark DRAF', !html.includes('class="draft"'));
  expect('logo kiri unggahan lokasi tampil di kop', /class="lg"><img src="\/api\/files\/settings\//.test(html));
  expect('logo kanan tetap logo bawaan SRT', html.includes('<img src="/api/files/default/logo-srt.png"'));
  expect('3 tanda tangan tampil di lembar persetujuan', (html.match(/\/api\/files\/signatures\//g) || []).length >= 3);
  const badPrint = await fetch(`${BASE}/api/hse-reports/${rid}/print?t=palsu`);
  expect('cetak tanpa token valid ditolak 401', badPrint.status === 401);
  if (process.env.PRINT_OUT) require('fs').writeFileSync(process.env.PRINT_OUT, `${BASE}${link.body.url}`);

  const list = (await call('GET', '/api/hse-reports', { token: sm })).body.reports;
  expect('daftar laporan untuk Site Manager', list.some((r) => r.id === rid && r.status === 'APPROVED'));

  console.log(failures ? `\n${failures} pengujian GAGAL` : '\nSemua pengujian lulus');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
