'use strict';
/**
 * Cuaca per jam Laporan K3 diisi OTOMATIS dari foto:
 *  - setiap jam kerja (jam mulai s/d jam selesai) memakai cuaca foto yang jamnya paling dekat
 *    dengan tengah jam tersebut (hanya foto yang masuk laporan dan sudah diberi cuaca);
 *  - nilai yang diisi MANUAL selalu menang atas nilai otomatis.
 * Kode: S cerah, C berawan, L hujan ringan, H hujan lebat.
 */
const CODES = new Set(['S', 'C', 'L', 'H']);
const toMin = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

function workHours(start, finish) {
  const a = Math.floor((toMin(start) ?? 8 * 60) / 60);
  const b = Math.ceil((toMin(finish) ?? 17 * 60) / 60);
  const out = [];
  for (let h = Math.max(0, a); h < Math.min(24, b); h++) out.push(h);
  return out;
}

/**
 * @param manual  {hour: code} isian manual (hasil simpan laporan)
 * @param photos  [{takenTime, sky, included}]
 * @returns {hour: {code, source: 'manual'|'photo', photoTime?}}
 */
function effectiveWeather({ manual = {}, photos = [], start, finish }) {
  const out = {};
  const usable = photos
    .filter((p) => (p.included === undefined || p.included === true || p.included === 1) && CODES.has(p.sky) && toMin(p.takenTime) != null)
    .map((p) => ({ min: toMin(p.takenTime), sky: p.sky, time: p.takenTime }));
  const hours = new Set(workHours(start, finish));
  for (const k of Object.keys(manual)) if (CODES.has(manual[k])) hours.add(Number(k));
  for (const h of [...hours].sort((x, y) => x - y)) {
    if (CODES.has(manual[h]) || CODES.has(manual[String(h)])) {
      out[h] = { code: manual[h] ?? manual[String(h)], source: 'manual' };
      continue;
    }
    if (!usable.length) continue;
    const mid = h * 60 + 30;
    const best = usable.reduce((a, b) => (Math.abs(b.min - mid) < Math.abs(a.min - mid) ? b : a));
    out[h] = { code: best.sky, source: 'photo', photoTime: best.time };
  }
  return out;
}

/** Bentuk sederhana {hour: code} untuk tabel cuaca. */
const codes = (eff) => Object.fromEntries(Object.entries(eff).map(([h, v]) => [h, v.code]));

module.exports = { effectiveWeather, codes, workHours };
