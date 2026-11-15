'use strict';
/**
 * Membuat HTML laporan harian K3 ukuran A4 (siap dicetak / "Simpan sebagai PDF" dari browser).
 * Struktur halaman mengikuti format laporan proyek: kop, uraian kegiatan, lampiran foto, site plan,
 * pemantauan cuaca, bagian A–J, dan lembar persetujuan.
 */
const lib = require('./hseLibrary');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const toMin = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };

const DAYS = { en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], id: ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'] };
const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  id: ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'],
};

// Label bahasa Indonesia (versi "id" untuk pengecekan; versi resmi bahasa Inggris)
const ID = {
  'DAILY WORK REPORT': 'LAPORAN KERJA HARIAN', TITLE: 'JUDUL', Date: 'Tanggal', Time: 'Waktu', Start: 'Mulai', Finish: 'Selesai', to: 's/d',
  Location: 'Lokasi', Category: 'Kategori', Subject: 'Subjek', Attachment: 'Lampiran', 'Activity Photo Attachment': 'Lampiran Foto Kegiatan',
  Members: 'Anggota', 'Bakamla RI (User/Inspector):': 'Bakamla RI (User/Inspektur):', '(Construction Contractor):': '(Kontraktor Pelaksana):',
  'TEAM BRIEFING CHECKLIST': 'CHECKLIST BRIEFING TIM', 'No.': 'No.', 'Inspection Item': 'Item Pemeriksaan', Yes: 'Ya', No: 'Tidak', Remarks: 'Keterangan',
  'ACTIVITY DESCRIPTION': 'URAIAN KEGIATAN', WORK: 'PEKERJAAN', NOTES: 'CATATAN', CONCLUSION: 'KESIMPULAN',
  'This activity report was prepared on': 'Laporan kegiatan ini dibuat pada', 'Acknowledged by,': 'Mengetahui,', 'Project Manager': 'Project Manager',
  'PHOTO ATTACHMENTS': 'LAMPIRAN FOTO', '(CONTINUED)': '(LANJUTAN)', 'WEATHER MONITORING': 'PEMANTAUAN CUACA', 'TIME \\ DATE': 'JAM \\ TGL',
  'Legend: S = Sunny | C = Cloudy | L = Light Rain | H = Heavy Rain': 'Keterangan: S = Cerah | C = Berawan | L = Hujan ringan | H = Hujan lebat',
  'WEATHER PHOTO ATTACHMENTS': 'LAMPIRAN FOTO CUACA', 'MIDDAY WEATHER MONITORING': 'PEMANTAUAN CUACA SIANG', 'AFTERNOON WEATHER MONITORING': 'PEMANTAUAN CUACA SORE',
  'A. PROJECT INFORMATION': 'A. INFORMASI PROYEK', 'Report No.': 'No. Laporan', 'Project Name': 'Nama Proyek', Client: 'Klien', 'HSE Officer': 'HSE Officer',
  'B. DAILY REPORT INFORMATION': 'B. INFORMASI LAPORAN HARIAN', 'DAY / DATE': 'HARI / TANGGAL', REPORT: 'LAPORAN', 'Weather Conditions': 'Kondisi Cuaca',
  Morning: 'Pagi', Midday: 'Siang', Afternoon: 'Sore', 'Working Hours': 'Jam Kerja', 'C. MANPOWER SUMMARY': 'C. REKAP TENAGA KERJA', Position: 'Jabatan', Quantity: 'Jumlah',
  'D. PPE LIST IN USE': 'D. DAFTAR APD YANG DIGUNAKAN', 'Equipment Type': 'Jenis Alat', Function: 'Fungsi',
  'E. WORK ACTIVITIES & HSE OBSERVATION': 'E. AKTIVITAS KERJA & OBSERVASI K3', 'Activity Description / Work Area': 'Uraian Aktivitas / Area Kerja',
  'F. INCIDENT / NEAR MISS / WORK ACCIDENT LOG': 'F. CATATAN INSIDEN / NEAR MISS / KECELAKAAN KERJA', 'Any Incident / Near Miss?': 'Ada Insiden / Near Miss?',
  'Type of Incident': 'Jenis Insiden', 'Time & Location': 'Waktu & Lokasi', 'Brief Description': 'Uraian Singkat', 'Casualties / Losses': 'Korban / Kerugian',
  'Emergency Action': 'Tindakan Darurat', YES: 'YA', NO: 'TIDAK', 'G. CUMULATIVE HSE STATISTICS': 'G. STATISTIK K3 KUMULATIF', Indicator: 'Indikator', Today: 'Hari Ini',
  'Total Work Hours (Man-Hours Today)': 'Total Jam Kerja (Man-Hours Hari Ini)', 'Man-Hours': 'Man-Hours', persons: 'orang', hours: 'jam',
  Fatality: 'Fatality', 'Near Miss': 'Near Miss', 'First Aid Case (FAC)': 'First Aid Case (FAC)', 'Property Damage': 'Kerusakan Properti',
  'H. HSE NOTES': 'H. CATATAN K3', 'I. DOCUMENTATION': 'I. DOKUMENTASI', 'J. APPROVAL': 'J. PERSETUJUAN', 'Prepared By': 'Disusun Oleh',
  'Acknowledged By': 'Diketahui Oleh', 'Approved By': 'Disetujui Oleh', 'P a g e': 'H a l', Legend: 'Keterangan', 'SITE PLAN': 'DENAH LOKASI',
  'BUILDING LAYOUT': 'DENAH BANGUNAN', 'COLUMN PLAN': 'DENAH KOLOM', 'WORK PROGRESS LAYOUT': 'DENAH PROGRES PEKERJAAN', DRAFT: 'DRAF – BELUM DISETUJUI',
};

function buildHtml({ report: h, settings: S, photos, members, weather, signatures, lang, nonce }) {
  const t = (s) => (lang === 'id' && ID[s]) || s;
  const C = h.content;
  const d0 = new Date(`${h.reportDate}T00:00:00Z`);
  const longDate = (s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return `${DAYS[lang][d.getUTCDay()]}, ${pad(d.getUTCDate())} ${MONTHS[lang][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  };

  const included = photos.filter((p) => p.included);
  const activities = [...(C.activities || [])].sort((a, b) => toMin(a.time) - toMin(b.time));
  const work = activities.filter((a) => !a.hse && a.work.trim());
  const notes = String(C.notes || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const heavy = activities.some((a) => a.heavy);
  if (heavy && !notes.some((n) => /heavy equipment|alat berat/i.test(n))) {
    notes.push("During heavy equipment operations, the work area was supervised by the HSE Officer and workers were instructed to keep a safe distance from the equipment's working radius.");
  }
  const category = h.category || lib.guessCategory(activities.map((a) => a.key));
  const subject = h.subject || `${category} – ${S.proj || h.siteName}`;
  const checklist = lang === 'id' ? lib.CHECKLIST_ID : lib.CHECKLIST;
  const insp = [...(S.insp || [])];
  while (insp.length < 2) insp.push('');
  const img = (src, alt = '') => (src ? `<img src="${esc(src)}" alt="${esc(alt)}">` : '');

  // Tanpa logo: tampilkan nama kontraktor sebagai teks (sama seperti format laporan lama).
  const conText = String(S.con || '').replace(/^PT\.?\s*/i, '').split(' ')[0].toUpperCase();
  const logoL = S.imgUrl.logoL ? img(S.imgUrl.logoL) : `<span class="lgtx">${esc(conText)}</span>`;
  const hdr = () => `<table class="hd"><tr><td class="lg">${logoL}</td>
    <td class="ttl">${esc(S.head).replace(/ \(/, '<br>(')}</td><td class="lg">${img(S.imgUrl.logoR)}</td></tr>
    <tr><td colspan="3" class="sub"><b>${t('TITLE')}</b>: ${t('DAILY WORK REPORT')}<div class="l2">${esc(S.title)}</div></td></tr></table><div class="gap"></div>`;

  const grid = (cells, cls = '') => {
    let out = `<table class="phg ${cls}">`;
    for (let i = 0; i < cells.length; i += 2) {
      const a = cells[i]; const b = cells[i + 1];
      out += `<tr><th>${esc(a?.cap || '')}</th><th>${esc(b?.cap || '')}</th></tr>
        <tr><td class="im">${img(a?.src)}</td><td class="im">${img(b?.src)}</td></tr>`;
    }
    return `${out}</table>`;
  };

  const pages = [];
  // 1. Halaman informasi + anggota + checklist
  pages.push(`${hdr()}<table>
    <tr><td class="k">${t('Date')}</td><td colspan="3">${longDate(h.reportDate)}</td></tr>
    <tr><td class="k">${t('Time')}</td><td style="width:240px">${t('Start')}: ${esc(h.startTime)}</td><td style="width:60px"><b>${t('to')}</b></td><td>${t('Finish')}: ${esc(h.finishTime)}</td></tr>
    <tr><td class="k">${t('Location')}</td><td colspan="3">${esc(S.loc || h.siteName)}</td></tr>
    <tr><td class="k">${t('Category')}</td><td colspan="3">${esc(category)}</td></tr>
    <tr><td class="k">${t('Subject')}</td><td colspan="3">${esc(subject)}</td></tr>
    <tr><td class="k">${t('Attachment')}</td><td colspan="3">${t('Activity Photo Attachment')}</td></tr>
    <tr><td class="k">${t('Members')}</td><td colspan="3" class="mem">
      <b>${t('Bakamla RI (User/Inspector):')}</b><ol>${insp.map((n) => `<li>${esc(n)}&nbsp;</li>`).join('')}</ol>
      <b>${esc(S.con)} ${t('(Construction Contractor):')}</b><ol>${members.map((m) => `<li>${esc(m.name)}${m.position ? ` (${esc(m.position)})` : ''}</li>`).join('')}</ol>
      <b>${t('TEAM BRIEFING CHECKLIST')}</b>
      <table style="margin-top:8px"><tr><th style="width:40px">${t('No.')}</th><th>${t('Inspection Item')}</th><th style="width:52px">${t('Yes')}</th><th style="width:52px">${t('No')}</th><th style="width:150px">${t('Remarks')}</th></tr>
      ${checklist.map((c, i) => `<tr><td class="ct">${i + 1}</td><td>${esc(c)}</td><td class="ct">${C.checklist[i] ? '✔' : ''}</td><td class="ct">${C.checklist[i] ? '' : '✔'}</td><td></td></tr>`).join('')}</table>
    </td></tr></table>`);

  // 2. Uraian kegiatan + tanda tangan PIC Site & PM
  pages.push(`${hdr()}<div class="ad"><div class="h">${t('ACTIVITY DESCRIPTION')}</div><div class="b">
    <div><div class="t">1.&nbsp;&nbsp;${t('WORK')}</div>${work.map((a, i) => `<div class="it"><span>1.${i + 1}</span><span>${esc(a.work)}</span></div>`).join('') || '<div class="it"><span></span><span>-</span></div>'}</div>
    <div><div class="t">2.&nbsp;&nbsp;${t('NOTES')}</div>${notes.map((n, i) => `<div class="it"><span>2.${i + 1}</span><span>${esc(n)}</span></div>`).join('')}</div>
    <div style="margin:0"><div class="t">3.&nbsp;&nbsp;${t('CONCLUSION')}</div><div class="it"><span>3.1</span><span>${esc(C.conclusion)}</span></div></div>
    </div></div>
    <p style="margin:12px 0 0">${t('This activity report was prepared on')} ${longDate(h.reportDate)}.</p>
    <div class="sig"><div><div style="height:14px"></div>${esc(S.con)},<div class="sp">${img(signatures.acknowledged)}</div>${esc(h.acknowledgedByName || S.pic)}<br>(PIC Site)</div>
    <div>${t('Acknowledged by,')}<br>${esc(S.con)},<div class="sp"></div>${esc(S.pm)}<br>(${t('Project Manager')})</div></div>`);

  // 3. Lampiran foto (4 per halaman)
  const cells = included.map((p) => ({ src: p.url, cap: p.caption }));
  if (!cells.length) pages.push(`${hdr()}<div class="sec">${t('PHOTO ATTACHMENTS')}</div><p>-</p>`);
  for (let i = 0; i < cells.length; i += 4) {
    pages.push(`${hdr()}<div class="sec">${t('PHOTO ATTACHMENTS')}${i ? ` ${t('(CONTINUED)')}` : ''}</div>${grid(cells.slice(i, i + 4))}`);
  }

  // 4. Site plan
  const sitePhoto = C.sitePhotoId ? photos.find((p) => p.id === C.sitePhotoId) : null;
  const siteSrc = sitePhoto?.url || S.imgUrl.site;
  if (siteSrc) {
    const legend = String(C.siteNote || '').split('\n').map((s) => s.trim()).filter(Boolean);
    pages.push(`${hdr()}<div class="sec">${t(C.siteTitle || 'SITE PLAN')}</div><div class="siteplan">${img(siteSrc)}</div>
      ${legend.length ? `<div class="legend"><b>${t('Legend')}:</b> ${legend.map(esc).join(' &nbsp;|&nbsp; ')}</div>` : ''}`);
  }

  // 5. Tabel cuaca per jam sebulan (dari laporan-laporan di lokasi yang sama)
  const dim = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 0)).getUTCDate();
  const mk = h.reportDate.slice(0, 7);
  let wt = `<table class="wxt"><tr><th>${t('TIME \\ DATE')}</th>${Array.from({ length: dim }, (_, i) => `<th>${i + 1}</th>`).join('')}</tr>`;
  for (let hr = 0; hr < 24; hr++) {
    wt += `<tr><td>${pad(hr)}.00 - ${pad(hr + 1)}.00</td>`;
    for (let d = 1; d <= dim; d++) {
      const key = `${mk}-${pad(d)}`;
      const c = key === h.reportDate ? (C.weather || {})[hr] : (weather[key] || {})[hr];
      wt += `<td class="${c ? `w-${c}` : ''}">${c || ''}</td>`;
    }
    wt += '</tr>';
  }
  wt += '</table>';
  pages.push(`${hdr()}<div class="sec">${t('WEATHER MONITORING')}</div>
    <div class="ct" style="font-weight:700;margin:6px 0 8px">${t('WEATHER MONITORING')} – ${esc((S.loc || h.siteName).split(',')[0]).toUpperCase()} (${MONTHS[lang][d0.getUTCMonth()].toUpperCase()} ${d0.getUTCFullYear()})</div>
    ${wt}<div class="legend">${t('Legend: S = Sunny | C = Cloudy | L = Light Rain | H = Heavy Rain').replace(/\|/g, '&nbsp;|&nbsp;')}</div>`);

  // 6. Foto cuaca
  const pm = photos.find((p) => p.id === C.weatherPhotos?.mid);
  const pa = photos.find((p) => p.id === C.weatherPhotos?.aft);
  if (pm || pa) {
    pages.push(`${hdr()}<div class="sec">${t('WEATHER PHOTO ATTACHMENTS')}</div>${grid([
      { src: pm?.url, cap: t('MIDDAY WEATHER MONITORING') }, { src: pa?.url, cap: t('AFTERNOON WEATHER MONITORING') }])}`);
  }

  // 7. Bagian A–D
  const W = C.weather || {};
  const wxName = lang === 'id' ? lib.WEATHER_ID : lib.WEATHER;
  const period = (a, b) => {
    const v = [];
    for (let i = a; i < b; i++) if (W[i]) v.push(W[i]);
    if (!v.length) return '-';
    const counts = v.reduce((m, c) => ({ ...m, [c]: (m[c] || 0) + 1 }), {});
    return wxName[Object.keys(counts).sort((x, y) => counts[y] - counts[x])[0]];
  };
  const roles = {};
  members.forEach((m) => { const r = String(m.position || 'Worker').replace(/\s*\d+$/, '').trim(); roles[r] = (roles[r] || 0) + 1; });
  const n = members.length;
  pages.push(`${hdr()}<div class="sec">${t('A. PROJECT INFORMATION')}</div><table class="pad">
    <tr><td class="kk">${t('Report No.')}</td><td>${esc(h.reportNo)}</td></tr>
    <tr><td class="kk">${t('Project Name')}</td><td>${esc(S.proj)}</td></tr>
    <tr><td class="kk">${t('Location')}</td><td>${esc(S.loc || h.siteName).toUpperCase()}</td></tr>
    <tr><td class="kk">${t('Client')}</td><td>${esc(S.client)}</td></tr>
    <tr><td class="kk">${t('HSE Officer')}</td><td>${esc((h.submittedByName || S.hse || '').toUpperCase())}</td></tr></table>
    <div class="sec">${t('B. DAILY REPORT INFORMATION')}</div><table class="pad">
    <tr><td class="kk">${t('DAY / DATE')}</td><td class="ct" style="font-weight:700">${longDate(h.reportDate).toUpperCase()}</td><td class="ct" style="font-weight:700">${t('REPORT')}</td><td class="ct" style="font-weight:700">${t('NOTES')}</td></tr>
    <tr><td>${t('Weather Conditions')}</td><td>${t('Morning')}: ${period(6, 11)};<br>${t('Midday')}: ${period(11, 14)};<br>${t('Afternoon')}: ${period(14, 18)}</td><td>${t('Working Hours')}: ${esc(h.startTime)} – ${esc(h.finishTime)}</td><td></td></tr></table>
    <div class="sec">${t('C. MANPOWER SUMMARY')}</div><table class="pad"><tr><th style="width:50px">${t('No.')}</th><th>${t('Position')}</th><th style="width:120px">${t('Quantity')}</th><th style="width:210px">${t('Remarks')}</th></tr>
    ${Object.entries(roles).map(([r, c], i) => `<tr><td class="ct">${i + 1}</td><td class="ct">${esc(r)}</td><td class="ct">${c}</td><td></td></tr>`).join('') || '<tr><td colspan="4" class="ct">-</td></tr>'}</table>
    <div class="sec">${t('D. PPE LIST IN USE')}</div><table class="pad"><tr><th style="width:50px">${t('No.')}</th><th style="width:190px">${t('Equipment Type')}</th><th>${t('Function')}</th><th style="width:150px">${t('Quantity')}</th></tr>
    ${(S.ppe || []).map((p, i) => `<tr><td class="ct">${i + 1}</td><td>${esc(p[0])}</td><td>${esc(p[1])}</td><td class="ct">${p[2] ? n : '-'}</td></tr>`).join('')}</table>`);

  // 8. Bagian E–G
  const hrs = Math.max(0, (toMin(h.finishTime) - toMin(h.startTime)) / 60 - (Number(S.brk) || 0));
  const I = C.incident || {};
  const inc = !!I.occurred;
  const yn = (b) => (b ? t('YES') : t('NO'));
  pages.push(`${hdr()}<div class="sec">${esc(t('E. WORK ACTIVITIES & HSE OBSERVATION'))}</div><table class="pad"><tr><th style="width:44px">${t('No.')}</th><th>${t('Activity Description / Work Area')}</th><th style="width:160px">${t('Time')}</th></tr>
    ${activities.map((a, i) => `<tr><td class="ct">${i + 1}</td><td>${esc(a.obs)}</td><td class="ct">${esc(a.time)}</td></tr>`).join('') || '<tr><td colspan="3" class="ct">-</td></tr>'}</table>
    <div class="sec">${t('F. INCIDENT / NEAR MISS / WORK ACCIDENT LOG')}</div><table class="pad">
    ${[['Any Incident / Near Miss?', yn(inc)], ['Type of Incident', inc ? I.type : '-'], ['Time & Location', inc ? I.timeLoc : '-'],
      ['Brief Description', inc ? I.desc : '-'], ['Casualties / Losses', inc ? I.loss : '-'], ['Emergency Action', inc ? I.action : '-']]
      .map(([a, b]) => `<tr><td class="kk">${t(a)}</td><td>${esc(b || '-')}</td></tr>`).join('')}</table>
    <div class="sec">${t('G. CUMULATIVE HSE STATISTICS')}</div><table class="pad"><tr><td class="kk" style="width:300px">${t('Indicator')}</td><td class="ct" style="font-weight:700">${t('Today')}</td></tr>
    <tr><td>${t('Total Work Hours (Man-Hours Today)')}</td><td class="ct">${+(n * hrs).toFixed(1)} ${t('Man-Hours')} (${n} ${t('persons')} × ${+hrs.toFixed(1)} ${t('hours')})</td></tr>
    ${['Fatality', 'Near Miss', 'First Aid Case (FAC)', 'Property Damage'].map((k) => {
      const hit = inc && new RegExp(k.split(' ')[0], 'i').test(I.type || '');
      return `<tr><td>${t(k)}</td><td class="ct">${yn(hit)}</td></tr>`;
    }).join('')}</table>`);

  // 9. Bagian H–J
  const docs = cells.slice(0, 4);
  pages.push(`${hdr()}<div class="sec" style="margin-top:28px">${t('H. HSE NOTES')}</div><div class="note"><p>1. ${esc(C.briefing)}</p><p style="margin:0">2. ${esc(C.monitoring)}</p></div>
    <div class="sec">${t('I. DOCUMENTATION')}</div>${docs.length ? grid(docs, 'doc') : '<p>-</p>'}
    <div class="sec" style="margin-top:28px">${t('J. APPROVAL')}</div><table class="appr"><tr><th>${t('Prepared By')}</th><th>${t('Acknowledged By')}</th><th>${t('Approved By')}</th></tr>
    <tr><td>${img(signatures.prepared)}${esc(h.submittedByName || S.hse)}<br><b>${t('HSE Officer')}</b></td>
    <td>${img(signatures.acknowledged)}${esc(h.acknowledgedByName || S.pic)}<br><b>PIC Site</b></td>
    <td>${img(signatures.approved)}${esc(h.approvedByName || S.hseM)}<br><b>HSE Manager</b></td></tr></table>`);

  const N = pages.length;
  const draft = h.status !== 'APPROVED' ? `<div class="draft">${t('DRAFT')}</div>` : '';
  const body = pages.map((p, i) => `<section class="pg">${draft}${p}<div class="foot">${t('P a g e')} <b>${i + 1}</b> | ${N}</div></section>`).join('');

  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(h.reportNo)} – ${esc(h.reportDate)}</title>
<style nonce="${nonce}">
@page{size:A4;margin:0}
*{box-sizing:border-box}
body{margin:0;background:#E5E7EB;font-family:Calibri,Carlito,Arial,sans-serif}
.bar{position:sticky;top:0;z-index:2;background:#16324F;color:#fff;padding:10px 16px;display:flex;gap:12px;align-items:center;font:14px system-ui,sans-serif}
.bar button{background:#E8590C;color:#fff;border:0;border-radius:6px;padding:9px 14px;font-weight:600;cursor:pointer}
.bar span{flex:1}
.pg{width:210mm;height:297mm;margin:12px auto;background:#fff;color:#000;font-size:12.5px;line-height:1.3;padding:52px 64px 40px;position:relative;overflow:hidden;page-break-after:always;box-shadow:0 1px 4px rgba(0,0,0,.2)}
table{border-collapse:collapse;width:100%}
td,th{border:1px solid #000;padding:3px 6px;vertical-align:top;text-align:left}
th{background:#D9D9D9;text-align:center;font-weight:700}
.hd td{vertical-align:middle}.hd .lg{width:126px;height:66px;text-align:center}.hd .lg img{max-width:110px;max-height:52px;object-fit:contain}.hd .lgtx{font-weight:700;font-size:15px;color:#2A8DB7}
.hd .ttl{text-align:center;font-family:Georgia,"Bookman Old Style",serif;font-weight:700;font-size:14.5px;line-height:1.35}
.hd .sub{font-family:Georgia,serif;font-weight:700;font-size:11px;padding:2px 6px}.hd .sub b{display:inline-block;width:84px}.hd .sub .l2{padding-left:94px}
.gap{height:18px}.k{font-weight:700;width:100px}.kk{font-weight:700;width:195px}.sec{font-weight:700;margin:16px 0 6px}.ct{text-align:center}
.pad td,.pad th{padding:6px 8px}.mem{height:760px}ol{margin:2px 0 10px 20px;padding:0}
.ad{border:1px solid #000}.ad .h{text-align:center;font-weight:700;padding:10px;border-bottom:1px solid #000}.ad .b{padding:10px 24px}
.ad .b>div{margin-bottom:12px}.ad .t{font-weight:700}.ad .it{display:grid;grid-template-columns:30px 1fr;padding-left:28px}
.sig{display:grid;grid-template-columns:1fr 1fr;margin-top:24px;text-align:center;font-weight:700;font-size:12px}.sig .sp{height:96px;display:grid;place-items:center}.sig .sp img{max-height:88px;max-width:180px}
.phg{width:calc(100% + 80px);margin-left:-40px;table-layout:fixed}.phg th{background:#fff;font-size:11.5px;padding:2px}
.phg td.im{height:196px;text-align:center;vertical-align:middle;padding:3px}.phg td.im img{max-width:100%;max-height:188px;object-fit:contain}
.doc td.im{height:150px}.doc td.im img{max-height:142px}
.wxt{width:calc(100% + 80px);margin-left:-40px;table-layout:fixed}.wxt td,.wxt th{font-size:7.2px;padding:1px;text-align:center;line-height:1.25;height:13px;vertical-align:middle}
.wxt th:first-child,.wxt td:first-child{width:62px}.w-S{background:#FFFF00}.w-C{background:#BFBFBF}.w-L{background:#9DC3E6}.w-H{background:#2E75B6;color:#fff}
.legend{font-size:10.5px;margin:6px -40px 0}
.siteplan{border:1px solid #000;padding:4px;text-align:center;width:calc(100% + 80px);margin-left:-40px}.siteplan img{max-width:100%;max-height:780px}
.note{border:1px solid #000;padding:6px 8px;text-align:justify;font-size:12px}.note p{margin:0 0 4px}
.appr{width:calc(100% + 80px);margin-left:-40px;table-layout:fixed}.appr th{background:#fff;font-size:11px}
.appr td{height:170px;text-align:center;vertical-align:bottom}.appr td img{max-height:90px;max-width:170px;display:block;margin:0 auto 14px}
.foot{position:absolute;right:64px;bottom:34px;color:#8496B0;font-weight:700;letter-spacing:.14em;font-size:12px}.foot b{color:#4472C4}
.draft{position:absolute;top:44%;left:0;right:0;text-align:center;font-size:64px;font-weight:700;color:rgba(200,0,0,.12);transform:rotate(-30deg);pointer-events:none}
@media print{body{background:#fff}.bar{display:none}.pg{margin:0;box-shadow:none}}
</style></head><body>
<div class="bar"><span>${esc(h.reportNo)} · ${esc(h.siteName)} · ${esc(h.reportDate)}</span><button id="p">${lang === 'id' ? 'Cetak / Simpan PDF' : 'Print / Save PDF'}</button></div>
${body}
<script nonce="${nonce}">document.getElementById('p').addEventListener('click',function(){window.print()});</script>
</body></html>`;
}

module.exports = { buildHtml };
