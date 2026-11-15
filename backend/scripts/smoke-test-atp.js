'use strict';
/**
 * Uji alur ATP Checklist terhadap API yang berjalan (gunakan DB uji!).
 *   API_URL=http://localhost:3000 SUPERADMIN_PASSWORD='...' node scripts/smoke-test-atp.js
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

(async () => {
  const sfx = Date.now().toString(36);
  const sa = (await call('POST', '/api/auth/login', { body: { username: process.env.SUPERADMIN_USERNAME || 'superadmin', password: process.env.SUPERADMIN_PASSWORD } })).body.token;
  const site = (await call('POST', '/api/sites', { token: sa, body: { name: `Site ATP ${sfx}`, latitude: -5.3, longitude: 119.3, radiusM: 100 } })).body.site;
  const other = (await call('POST', '/api/sites', { token: sa, body: { name: `Site ATP Lain ${sfx}`, latitude: -5.4, longitude: 119.4, radiusM: 100 } })).body.site;
  const mk = async (role, siteId) => {
    const u = `${role.toLowerCase()}_a${sfx}`;
    await call('POST', '/api/users', { token: sa, body: { username: u, fullName: `${role} ${sfx}`, password: 'Password123', role, siteId } });
    return (await call('POST', '/api/auth/login', { body: { username: u, password: 'Password123' } })).body.token;
  };
  const sm = await mk('SITE_MANAGER', site.id);
  const pm = await mk('PROJECT_MANAGER', null);
  const ho = await mk('HSE_OFFICER', site.id);
  const sig = await sharp({ create: { width: 300, height: 100, channels: 3, background: '#fff' } })
    .composite([{ input: Buffer.from('<svg width="300" height="100"><path d="M20 70 Q 100 10 160 60 T 280 40" stroke="#123" stroke-width="5" fill="none"/></svg>') }]).png().toBuffer();
  const giveSig = async (tok) => { const f = new FormData(); f.append('file', new Blob([sig], { type: 'image/png' }), 's.png'); await call('POST', '/api/hse-reports/me/signature', { token: tok, form: f }); };

  const meta = (await call('GET', '/api/atp/meta', { token: sm })).body;
  expect('daftar item standar A-E tersedia', ['A', 'B', 'C', 'D', 'E'].every((k) => meta.standardItems[k]?.length >= 5), Object.keys(meta.standardItems || {}));
  expect('HSE Officer tidak punya akses ATP (403)', (await call('GET', '/api/atp', { token: ho })).status === 403);
  expect('PM tidak menyusun ATP (403)', (await call('POST', '/api/atp', { token: pm, body: { siteId: site.id, workArea: 'X', sections: ['A'] } })).status === 403);
  expect('SM tidak bisa buat ATP lokasi lain (403)', (await call('POST', '/api/atp', { token: sm, body: { siteId: other.id, workArea: 'X', sections: ['A'] } })).status === 403);

  const c = await call('POST', '/api/atp', { token: sm, body: { siteId: site.id, workArea: 'Gedung Utama – As 1-4', sections: ['A', 'C'] } });
  expect('SM buat ATP (Fondasi + Kolom)', c.status === 201, c.body);
  const atpId = c.body.id;
  let doc = (await call('GET', `/api/atp/${atpId}`, { token: sm })).body;
  expect('item standar Fondasi & Kolom tersalin', doc.items.length === meta.standardItems.A.length + meta.standardItems.C.length
    && doc.items.every((i) => ['A', 'C'].includes(i.section)) && /^ATP-\d{8}-\d{4}$/.test(doc.document.docNo), doc.document);

  // Isi ukuran: semua sesuai kecuali kedalaman galian (melebihi toleransi), plus 1 item tambahan
  const items = doc.items.map((i) => {
    const v = { ...i };
    if (i.unit === 'mm' || i.unit === 'pcs') {
      v.planned = '1200'; v.tolerance = '±10';
      v.actual = /excavation depth/i.test(i.description) ? '1180' : '1205';
    }
    return v;
  });
  items.push({ section: 'C', description: 'Concrete compressive strength test (cylinder)', unit: 'MPa', planned: '25', actual: '27', tolerance: '+5/-0' });
  const save1 = await call('PUT', `/api/atp/${atpId}`, { token: sm, body: { items: items.map(({ photoUrl, suggested, seq, ...x }) => x) } });
  expect('simpan ukuran DED/aktual/toleransi + item tambahan', save1.status === 200, save1.body);
  doc = (await call('GET', `/api/atp/${atpId}`, { token: sm })).body;
  const dig = doc.items.find((i) => /excavation depth/i.test(i.description));
  const width = doc.items.find((i) => /width/i.test(i.description) && i.section === 'A');
  const added = doc.items.find((i) => /compressive/i.test(i.description));
  expect('saran otomatis: 1205 vs 1200 ±10 -> APPROVE', width.suggested === 'APPROVE', width);
  expect('saran otomatis: 1180 vs 1200 ±10 -> REJECT', dig.suggested === 'REJECT', dig);
  expect('saran otomatis toleransi +5/-0: 27 vs 25 -> APPROVE', added?.suggested === 'APPROVE', added);
  const visual = doc.items.find((i) => !i.unit);
  expect('item visual tanpa saran (dipilih manual)', visual && visual.suggested === null, visual);

  const subEmpty = await call('POST', `/api/atp/${atpId}/submit`, { token: sm });
  expect('kirim saat ada item tanpa hasil ditolak (422)', subEmpty.status === 422, subEmpty.body);
  // Terapkan hasil: pakai saran; visual APPROVE; item REJECT tanpa keterangan dulu
  const withResult = doc.items.map((i) => ({ ...i, result: i.suggested || 'APPROVE' }));
  await call('PUT', `/api/atp/${atpId}`, { token: sm, body: { items: withResult.map(({ photoUrl, suggested, seq, ...x }) => x) } });
  const subNoReason = await call('POST', `/api/atp/${atpId}/submit`, { token: sm });
  expect('item REJECT tanpa keterangan perbaikan ditolak (422)', subNoReason.status === 422 && /keterangan/.test(subNoReason.body.message), subNoReason.body);
  const fixed = withResult.map((i) => (i.result === 'REJECT' ? { ...i, remarks: 'Kedalaman kurang 20 mm, gali ulang' } : i));
  await call('PUT', `/api/atp/${atpId}`, { token: sm, body: { items: fixed.map(({ photoUrl, suggested, seq, ...x }) => x) } });

  const fd = new FormData();
  fd.append('photo', new Blob([await sharp({ create: { width: 640, height: 480, channels: 3, background: '#8a6a3b' } }).jpeg().toBuffer()], { type: 'application/octet-stream' }), 'galian.jpg');
  const ph = await call('POST', `/api/atp/${atpId}/items/${dig.id}/photo`, { token: sm, form: fd });
  expect('foto per item', ph.status === 200 && ph.body.photoUrl, ph.body);

  const noSig = await call('POST', `/api/atp/${atpId}/submit`, { token: sm });
  expect('kirim tanpa tanda tangan ditolak (422)', noSig.status === 422 && noSig.body.code === 'SIGNATURE_REQUIRED');
  await giveSig(sm);
  expect('SM kirim ATP', (await call('POST', `/api/atp/${atpId}/submit`, { token: sm })).status === 200);
  expect('ATP terkunci setelah dikirim (403)', (await call('PUT', `/api/atp/${atpId}`, { token: sm, body: { notes: 'x' } })).status === 403);
  const ret = await call('POST', `/api/atp/${atpId}/return`, { token: pm, body: { note: 'Lengkapi foto kolom' } });
  expect('PM kembalikan untuk revisi', ret.status === 200);
  await call('PUT', `/api/atp/${atpId}`, { token: sm, body: { notes: 'Foto kolom dilampirkan' } });
  await call('POST', `/api/atp/${atpId}/submit`, { token: sm });
  const apNoSig = await call('POST', `/api/atp/${atpId}/approve`, { token: pm });
  expect('PM tanpa tanda tangan tidak bisa menyetujui (422)', apNoSig.status === 422);
  await giveSig(pm);
  const ap = await call('POST', `/api/atp/${atpId}/approve`, { token: pm });
  expect('PM setujui ATP', ap.status === 200, ap.body);

  doc = (await call('GET', `/api/atp/${atpId}`, { token: pm })).body;
  expect('ringkasan: 1 REJECT (rework), sisanya APPROVE', doc.summary.reject === 1 && doc.summary.empty === 0 && doc.summary.approve === doc.summary.total - 1, doc.summary);
  const link = await call('POST', `/api/atp/${atpId}/print-link`, { token: sm });
  const html = await (await fetch(BASE + link.body.url)).text();
  expect('cetak ATP sesuai format dokumen', ['ACCEPTANCE TEST PROCEDURE (ATP)', 'A. FOUNDATION WORKS', 'C. COLUMN WORKS', 'DED SIZE (PLANNED)', 'gali ulang', 'CONTRACTOR', 'APPROVED BY', 'logo-prima.png', 'logo-srt.png'].every((x) => html.includes(x)));
  expect('tanda tangan PM di kolom CONTRACTOR, kolom APPROVED BY kosong untuk tanda tangan basah', (html.match(/\/api\/files\/signatures\//g) || []).length === 1 && !html.includes('NOT YET APPROVED'));
  if (process.env.PRINT_OUT) require('fs').writeFileSync(process.env.PRINT_OUT, BASE + link.body.url);
  const list = (await call('GET', '/api/atp', { token: sm })).body.documents;
  expect('daftar ATP untuk SM (jumlah REJECT tampil)', list.some((d) => d.id === atpId && d.rejectCount === 1));

  console.log(failures ? `\n${failures} pengujian GAGAL` : '\nSemua pengujian lulus');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
