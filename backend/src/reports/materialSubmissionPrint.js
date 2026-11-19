'use strict';
/** Formulir "Material Purchase Submission & Approval" (format dokumen proyek PRIMA). */
const { kopHtml, BASE_CSS, esc } = require('./kop');

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: process.env.APP_TIMEZONE || 'Asia/Jakarta' }) : '');
const qty = (n) => (Number(n) || 0).toLocaleString('id-ID', { maximumFractionDigits: 3 });

function buildSubmissionHtml({ header: h, items, logos, signatures, nonce }) {
  const { settings: S } = logos;
  const box = (on) => (on ? '☑' : '☐');
  const rows = items.map((it, i) => `<tr>
    <td class="ct">${i + 1}</td>
    <td><b>${esc(it.name)}</b><div style="font-size:10px">${esc(it.code)} · ${qty(it.qty)} ${esc(it.unit)}</div></td>
    <td>${esc(it.brand || '')}</td>
    <td>${esc(it.spec || '')}</td>
    <td class="ct ph">${it.photoUrl ? `<img src="${esc(it.photoUrl)}" alt="">` : '<span style="color:#888">-</span>'}</td>
    <td style="white-space:nowrap">${box(it.itemStatus === 'APPROVED')} Approve<br>${box(it.itemStatus === 'REJECTED')} Reject</td>
    <td>${esc(it.decisionNote || '')}</td></tr>`).join('');
  const pending = h.status === 'PENDING';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(h.requestNo)} – Material Submission</title>
<style nonce="${nonce}">@page{size:A4 landscape;margin:10mm}${BASE_CSS}
.pg{width:277mm}.items td{vertical-align:top}.ph img{max-width:110px;max-height:80px;object-fit:contain}</style></head><body>
<div class="bar"><span>${esc(h.requestNo)} · ${esc(h.siteName)} · ${esc(h.statusLabel || h.status)}</span><button id="p">Print / Save PDF</button></div>
<section class="pg">${pending ? '<div class="wm">PENDING APPROVAL</div>' : ''}
${kopHtml(logos.logos, 'MATERIAL PURCHASE SUBMISSION & APPROVAL', 'Construction Project Procurement Form')}
<h1>MATERIAL PURCHASE SUBMISSION &amp; APPROVAL FORM</h1>
<p class="sub">Submission of Material Purchase for Review and Approval Prior to Procurement</p>
<table class="info">
<tr><td class="k">Project Name</td><td>${esc(S.proj)}</td><td class="k">Document No.</td><td>${esc(h.requestNo)}</td></tr>
<tr><td class="k">Vendor/Contractor Name</td><td>${esc(S.con)}</td><td class="k">Submission Date</td><td>${fmtDate(h.requestedAt)}</td></tr>
<tr><td class="k">Material Package/Category</td><td>${esc(h.category || '')}</td><td class="k">Reviewed By</td><td>${esc(h.decidedByName || '')}</td></tr>
</table>
<table class="items" style="margin-top:10px"><tr><th style="width:34px">NO</th><th>MATERIAL DESCRIPTION</th><th style="width:13%">BRAND</th><th style="width:20%">TYPE / SPECIFICATION</th><th style="width:120px">PHOTO</th><th style="width:85px">APPROVAL</th><th style="width:18%">NOTES / REASON (IF REJECTED)</th></tr>
${rows}</table>
<p class="note">Note: Attach a clear photo of the material with visible brand/type label. The "Approval" column must be marked APPROVE before the material is purchased, or REJECT with the reason noted for revision/replacement.</p>
<div class="sig">
<div><div class="h">SUBMITTED BY</div>(Name &amp; Signature)<div class="sp">${signatures.submitted ? `<img src="${esc(signatures.submitted)}" alt="">` : ''}</div><b>${esc(h.requestedByName)}</b><br>Date: ${fmtDate(h.requestedAt)}</div>
<div><div class="h">APPROVED BY</div>(Name &amp; Signature)<div class="sp">${signatures.approved ? `<img src="${esc(signatures.approved)}" alt="">` : ''}</div><b>${esc(h.decidedByName || '')}</b><br>Date: ${h.decidedAt ? fmtDate(h.decidedAt) : '____________________'}</div>
</div>
</section>
<script nonce="${nonce}">document.getElementById('p').addEventListener('click',function(){window.print()});</script>
</body></html>`;
}

module.exports = { buildSubmissionHtml };
