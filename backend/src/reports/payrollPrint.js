'use strict';
/** Lembar rekap upah mingguan (A4 landscape) untuk dicetak / disimpan PDF. */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rp = (n) => (Number(n) || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 });
const DAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const longDate = (s) => { const [y, m, d] = s.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const CAT = { MANDOR: 'Mandor', TUKANG: 'Tukang', BURUH: 'Buruh' };

function buildPayrollHtml({ site, recap, status, statusLabel, submittedBy, approvedBy, submittedSig, approvedSig, nonce }) {
  const sym = { FULL: 'H', HALF: '½', ABSENT: 'A' };
  const cell = (c) => (c ? `<td class="ct st-${c.status}">${sym[c.status]}${c.overtimeHours ? `<sup>+${c.overtimeHours}</sup>` : ''}</td>` : '<td class="ct">·</td>');
  let rows = '';
  let lastCat = null;
  recap.rows.forEach((r, i) => {
    if (r.category !== lastCat) { rows += `<tr class="grp"><td colspan="${recap.days.length + 10}">${CAT[r.category]}</td></tr>`; lastCat = r.category; }
    rows += `<tr><td class="ct">${i + 1}</td><td>${esc(r.name)}${r.trade ? `<div class="sm">${esc(r.trade)}</div>` : ''}</td>
      ${recap.days.map((d) => cell(r.days[d])).join('')}
      <td class="ct">${r.workDays}</td><td class="num">${(r.ratesUsed || [r.dailyRate]).map(rp).join(' / ')}</td><td class="num">${rp(r.wage)}</td>
      <td class="ct">${r.overtimeHours || '-'}</td><td class="num">${r.overtimePay ? rp(r.overtimePay) : '-'}</td>
      <td class="num">${r.advance ? `(${rp(r.advance)})` : '-'}</td><td class="num b${r.net < 0 ? ' neg' : ''}">${rp(r.net)}</td><td></td></tr>`;
  });
  const t = recap.totals;
  const draft = !['APPROVED', 'PAID'].includes(status);
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Rekap Upah ${esc(site.name)} ${recap.weekStart}</title>
<style nonce="${nonce}">
@page{size:A4 landscape;margin:10mm}
body{font-family:Calibri,Arial,sans-serif;font-size:11px;color:#000;margin:0;background:#E5E7EB}
.bar{position:sticky;top:0;background:#16324F;color:#fff;padding:10px 16px;display:flex;gap:10px;align-items:center;font:14px system-ui,sans-serif}
.bar span{flex:1}.bar button{background:#E8590C;color:#fff;border:0;border-radius:6px;padding:8px 14px;font-weight:600;cursor:pointer}
.pg{background:#fff;width:277mm;margin:12px auto;padding:8mm;position:relative;box-shadow:0 1px 4px rgba(0,0,0,.2)}
h1{font-size:16px;margin:0;text-align:center}.sub{text-align:center;margin:2px 0 10px}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #000;padding:3px 4px;vertical-align:middle}
th{background:#D9D9D9}.ct{text-align:center}.num{text-align:right;white-space:nowrap}.b{font-weight:700}.neg{color:#C00}
.sm{font-size:9px;color:#555}.grp td{background:#EEF2F7;font-weight:700}
.st-HALF{background:#FFF4CC}.st-ABSENT{background:#F8D7DA}sup{font-size:8px;color:#1565C0}
.tot td{font-weight:700;background:#F3F4F6}
.sum{display:flex;gap:16px;margin-top:10px}.sum table{width:auto}
.sig{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:16px;text-align:center}
.sig .sp{height:70px;display:grid;place-items:center}.sig img{max-height:64px;max-width:180px}
.legend{margin-top:6px;font-size:10px}
.draft{position:absolute;top:40%;left:0;right:0;text-align:center;font-size:72px;font-weight:700;color:rgba(200,0,0,.10);transform:rotate(-18deg);pointer-events:none}
@media print{body{background:#fff}.bar{display:none}.pg{margin:0;box-shadow:none;width:auto;padding:0}}
</style></head><body>
<div class="bar"><span>Rekap Upah · ${esc(site.name)} · ${esc(statusLabel)}</span><button id="p">Cetak / Simpan PDF</button></div>
<section class="pg">${draft ? '<div class="draft">BELUM DISETUJUI</div>' : ''}
<h1>REKAP UPAH TENAGA KERJA HARIAN</h1>
<div class="sub">${esc(site.name)} · Periode ${longDate(recap.weekStart)} – ${longDate(recap.weekEnd)} (Senin–Sabtu) · Status: ${esc(statusLabel)}</div>
<table><thead><tr><th rowspan="2">No</th><th rowspan="2">Nama</th>${recap.days.map((d, i) => `<th>${DAYS[i]}</th>`).join('')}
<th rowspan="2">Hari<br>Kerja</th><th rowspan="2">Upah/Hari</th><th rowspan="2">Upah</th><th rowspan="2">Jam<br>Lembur</th><th rowspan="2">Upah<br>Lembur</th><th rowspan="2">Kasbon</th><th rowspan="2">Diterima</th><th rowspan="2" style="width:70px">Paraf</th></tr>
<tr>${recap.days.map((d) => `<th>${d.slice(8)}/${d.slice(5, 7)}</th>`).join('')}</tr></thead>
<tbody>${rows}
<tr class="tot"><td colspan="${2 + recap.days.length}" class="ct">TOTAL (${t.people} orang)</td><td class="ct">${t.workDays}</td><td></td><td class="num">${rp(t.wage)}</td><td class="ct">${t.overtimeHours}</td><td class="num">${rp(t.overtimePay)}</td><td class="num">(${rp(t.advance)})</td><td class="num">${rp(t.net)}</td><td></td></tr>
</tbody></table>
<div class="legend">H = masuk penuh (1 hari) · ½ = setengah hari (50%) · A = tidak masuk · · = belum diabsen · <sup>+n</sup> = jam lembur · Kasbon dipotong dari upah pekan ini.
${t.negativeNet.length ? `<b class="neg">Perhatian: kasbon melebihi upah untuk ${esc(t.negativeNet.join(', '))}.</b>` : ''}</div>
<div class="sum"><table><tr><th>Kategori</th><th>Orang</th><th>Hari Kerja</th><th>Upah + Lembur</th><th>Kasbon</th><th>Diterima</th></tr>
${recap.byCategory.map((c) => `<tr><td>${esc(c.label)}</td><td class="ct">${c.people}</td><td class="ct">${c.workDays}</td><td class="num">${rp(c.wage + c.overtimePay)}</td><td class="num">${rp(c.advance)}</td><td class="num b">${rp(c.net)}</td></tr>`).join('')}
</table></div>
<div class="sig"><div>Diajukan oleh,<div class="sp">${submittedSig ? `<img src="${esc(submittedSig)}" alt="">` : ''}</div><b>${esc(submittedBy || '..................................')}</b><br>Site Manager</div>
<div>Disetujui oleh,<div class="sp">${approvedSig ? `<img src="${esc(approvedSig)}" alt="">` : ''}</div><b>${esc(approvedBy || '..................................')}</b><br>Project Manager</div></div>
</section>
<script nonce="${nonce}">document.getElementById('p').addEventListener('click',function(){window.print()});</script>
</body></html>`;
}

module.exports = { buildPayrollHtml };
