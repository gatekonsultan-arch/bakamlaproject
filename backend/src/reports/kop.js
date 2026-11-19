'use strict';
/**
 * Kop dokumen bersama (logo PRIMA kiri & SRT kanan) untuk formulir cetak selain Laporan Harian K3.
 * Logo mengikuti Pengaturan Laporan lokasi; bila belum diunggah memakai logo bawaan.
 */
const db = require('../db');
const files = require('../utils/files');
const lib = require('./hseLibrary');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function loadSiteReport(siteId) {
  const row = await db.one('SELECT settings FROM site_report_settings WHERE site_id = :id', { id: siteId });
  const stored = row ? JSON.parse(row.settings) : {};
  const settings = { ...lib.DEFAULT_SETTINGS, ...stored, img: { ...lib.DEFAULT_SETTINGS.img, ...(stored.img || {}) } };
  const url = (slot) => (settings.img[slot] ? files.signFile('settings', settings.img[slot]) : `/api/files/default/${lib.DEFAULT_LOGOS[slot]}`);
  return { settings, logos: { left: url('logoL'), right: url('logoR') } };
}

async function loadLogos(siteId) {
  return loadSiteReport(siteId);
}

/** Tabel kop: logo kiri | judul (2 baris) | logo kanan */
function kopHtml(logos, title, subtitle) {
  return `<table class="kop"><tr>
    <td class="lg"><img src="${esc(logos.left)}" alt=""></td>
    <td class="tt"><div class="t1">${esc(title)}</div><div class="t2">${esc(subtitle)}</div></td>
    <td class="lg"><img src="${esc(logos.right)}" alt=""></td></tr></table>`;
}

const BASE_CSS = `
*{box-sizing:border-box}body{margin:0;background:#E5E7EB;font-family:Calibri,Carlito,Arial,sans-serif;color:#000}
.bar{position:sticky;top:0;z-index:2;background:#16324F;color:#fff;padding:10px 16px;display:flex;gap:12px;align-items:center;font:14px system-ui,sans-serif}
.bar span{flex:1}.bar button{background:#E8590C;color:#fff;border:0;border-radius:6px;padding:9px 14px;font-weight:600;cursor:pointer}
.pg{background:#fff;margin:12px auto;padding:12mm 12mm 14mm;position:relative;box-shadow:0 1px 4px rgba(0,0,0,.2);font-size:11.5px;line-height:1.3}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #000;padding:4px 6px;vertical-align:middle}
th{background:#D9D9D9;text-align:center;font-weight:700;font-size:10.5px}
.kop td{height:68px}.kop .lg{width:150px;text-align:center}.kop .lg img{max-width:135px;max-height:56px;object-fit:contain}
.kop .tt{text-align:center}.kop .t1{font-family:Georgia,serif;font-weight:700;font-size:15px}.kop .t2{font-size:11.5px;margin-top:3px}
h1{text-align:center;font-size:16px;margin:14px 0 2px}.sub{text-align:center;margin:0 0 10px;font-style:italic}
.info td{padding:5px 7px}.info .k{font-weight:700;width:22%;background:#F3F4F6}
.ct{text-align:center}.note{font-size:10.5px;margin:8px 0;font-style:italic}
.sig{display:grid;grid-template-columns:1fr 1fr;gap:0;margin-top:14px}
.sig>div{border:1px solid #000;padding:8px;text-align:center;min-height:130px}
.sig .h{font-weight:700}.sig .sp{height:70px;display:grid;place-items:center}.sig img{max-height:64px;max-width:170px}
.ok{color:#1E7F4F;font-weight:700}.no{color:#C00;font-weight:700}
.wm{position:absolute;top:45%;left:0;right:0;text-align:center;font-size:56px;font-weight:700;color:rgba(200,0,0,.10);transform:rotate(-20deg);pointer-events:none}
@media print{body{background:#fff}.bar{display:none}.pg{margin:0;box-shadow:none;padding:0}}`;

module.exports = { loadSiteReport, loadLogos, kopHtml, BASE_CSS, esc };
