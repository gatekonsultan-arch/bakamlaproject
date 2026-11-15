'use strict';
/** Formulir cetak ATP Checklist (format dokumen proyek PRIMA). */
const { kopHtml, BASE_CSS, esc } = require('./kop');

const fmtDate = (d) => {
  if (!d) return '';
  const x = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00Z`) : new Date(d);
  return x.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: /T00:00:00Z$/.test(x.toISOString()) ? 'UTC' : (process.env.APP_TIMEZONE || 'Asia/Jakarta') });
};
const withUnit = (v, u) => (v ? `${esc(v)}${u && /^-?[\d.,]+$/.test(String(v).trim()) ? ` ${esc(u)}` : ''}` : '');

function buildAtpHtml({ h, items, sections, site, signatures, nonce }) {
  const S = site.settings;
  let rows = '';
  let n = 0;
  for (const sec of Object.keys(sections)) {
    const list = items.filter((i) => i.section === sec);
    if (!list.length) continue;
    rows += `<tr class="grp"><td colspan="8">${sec}. ${esc(sections[sec])}</td></tr>`;
    for (const it of list) {
      n += 1;
      rows += `<tr><td class="ct">${n}</td><td>${esc(it.description)}</td>
        <td class="ct">${withUnit(it.planned, it.unit)}</td><td class="ct">${withUnit(it.actual, it.unit)}</td>
        <td class="ct">${withUnit(it.tolerance, it.unit)}</td>
        <td class="ct ${it.result === 'APPROVE' ? 'ok' : it.result === 'REJECT' ? 'no' : ''}">${esc(it.result || '')}</td>
        <td>${esc(it.remarks || '')}</td>
        <td class="ct ph">${it.photoUrl ? `<img src="${esc(it.photoUrl)}" alt="">` : ''}</td></tr>`;
    }
  }
  const rej = items.filter((i) => i.result === 'REJECT').length;
  const app = items.filter((i) => i.result === 'APPROVE').length;
  const draft = h.status !== 'APPROVED';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(h.docNo)} – ATP</title>
<style nonce="${nonce}">@page{size:A4 landscape;margin:10mm}${BASE_CSS}
.pg{width:277mm}.grp td{background:#EEF2F7;font-weight:700}.items td{vertical-align:middle}.ph img{max-width:100px;max-height:70px;object-fit:contain}
.sum{margin-top:6px;font-size:11px}</style></head><body>
<div class="bar"><span>${esc(h.docNo)} · ${esc(h.siteName)} · ${esc(h.status)}</span><button id="p">Print / Save PDF</button></div>
<section class="pg">${draft ? '<div class="wm">NOT YET APPROVED</div>' : ''}
${kopHtml(site.logos, 'ACCEPTANCE TEST PROCEDURE (ATP)', 'Construction Work Quality Checklist')}
<h1>ACCEPTANCE TEST PROCEDURE (ATP)</h1>
<p class="sub">Structural Work Quality Checklist (Foundation, Reinforcement, Column, Beam, Slab)</p>
<table class="info">
<tr><td class="k">Project Name</td><td>${esc(S.proj)}</td><td class="k">ATP Document No.</td><td>${esc(h.docNo)}</td></tr>
<tr><td class="k">Vendor/Contractor Name</td><td>${esc(S.con)}</td><td class="k">Inspection Date</td><td>${fmtDate(h.inspectionDate)}</td></tr>
<tr><td class="k">Location / Work Area</td><td>${esc(h.workArea)} – ${esc(h.siteName)}</td><td class="k">Inspected By</td><td>${esc(h.submittedByName || h.createdByName)}</td></tr>
</table>
<table class="items" style="margin-top:10px"><tr><th style="width:32px">NO</th><th>CHECKLIST DESCRIPTION / WORK ITEM</th><th style="width:11%">DED SIZE (PLANNED)</th><th style="width:11%">ACTUAL SIZE (AS-BUILT)</th><th style="width:9%">TOLERANCE</th><th style="width:9%">RESULT (APPROVE/REJECT)</th><th style="width:17%">REMARKS</th><th style="width:110px">PHOTO / IMAGE</th></tr>
${rows}</table>
<div class="sum">Summary: ${items.length} items · <span class="ok">${app} APPROVE</span> · <span class="no">${rej} REJECT</span>${rej ? ' (rework required)' : ''}${h.notes ? ` · Notes: ${esc(h.notes)}` : ''}</div>
<p class="note">Note: The "Result" column should be filled with APPROVE if the actual size complies with the tolerance against the DED (design drawing), or REJECT if it does not comply and requires rework.</p>
<div class="sig">
<div><div class="h">CONTRACTOR</div>(Name &amp; Signature)<div class="sp">${signatures.approved ? `<img src="${esc(signatures.approved)}" alt="">` : ''}</div>
<b>${esc(h.approvedByName || '')}</b>${h.approvedByName ? ' – Project Manager' : ''}<br>Date: ${h.approvedAt ? fmtDate(h.approvedAt) : '____________________'}
<div style="font-size:9.5px;margin-top:4px">Prepared by: ${esc(h.submittedByName || h.createdByName)} (Site Manager)</div></div>
<div><div class="h">APPROVED BY</div>(Name &amp; Signature)<div class="sp"></div><b>..............................................</b><br>Date: ____________________</div>
</div>
</section>
<script nonce="${nonce}">document.getElementById('p').addEventListener('click',function(){window.print()});</script>
</body></html>`;
}

module.exports = { buildAtpHtml };
