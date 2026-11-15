'use strict';
/**
 * Bantuan uji absensi dengan selfie.
 * Set TEST_SELFIE=/path/foto-wajah-satu-orang.jpg (foto Anda sendiri; JANGAN di-commit ke repo).
 * Setiap pemanggilan menghasilkan varian foto berbeda (sidik berbeda) agar tidak ditolak sebagai "foto dipakai ulang".
 */
const fs = require('fs');
const sharp = require('sharp');

let n = 0;
async function selfie() {
  const p = process.env.TEST_SELFIE;
  if (!p || !fs.existsSync(p)) throw new Error('Set TEST_SELFIE ke path foto wajah satu orang untuk menguji absensi selfie');
  n += 1;
  // Titik 2x2 berwarna acak di pojok -> sidik foto selalu unik antar pemanggilan & antar putaran uji.
  const rnd = require('crypto').randomBytes(3);
  const dot = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: rnd[0], g: rnd[1], b: rnd[2] } } }).png().toBuffer();
  return sharp(fs.readFileSync(p)).composite([{ input: dot, left: 0, top: 0 }]).jpeg({ quality: 90 }).toBuffer();
}

/** Kirim check-in/check-out multipart (lokasi + foto). */
async function postAttendance(base, path, token, loc, photo) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(loc)) if (v !== undefined && v !== null) fd.append(k, String(v));
  // Sengaja tanpa jenis file (octet-stream), meniru upload dari aplikasi.
  if (photo) fd.append('photo', new Blob([photo], { type: 'application/octet-stream' }), 'selfie.jpg');
  const res = await fetch(base + path, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

async function consent(base, token) {
  return fetch(`${base}/api/attendance/face-consent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ agree: true }),
  });
}

module.exports = { selfie, postAttendance, consent };
