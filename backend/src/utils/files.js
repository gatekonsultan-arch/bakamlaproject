'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const exifr = require('exifr');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { badRequest, unauthorized } = require('./errors');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads'));
const MAX_FILE_MB = parseInt(process.env.MAX_UPLOAD_MB || '15', 10);

/** Upload disimpan di memori dulu, lalu divalidasi & diproses ulang oleh sharp. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 20 },
  // Beberapa klien (mis. aplikasi Flutter / browser tertentu) mengirim tanpa jenis file
  // (application/octet-stream). Itu diterima di sini karena ISI file selalu divalidasi ulang
  // oleh sharp (saveImage/saveSignature/checkSelfie): file yang bukan gambar tetap ditolak.
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|jpg|png|webp|heic|heif)$/.test(file.mimetype) && file.mimetype !== 'application/octet-stream') {
      return cb(badRequest('Hanya file gambar JPG, PNG, atau WEBP yang diizinkan'));
    }
    cb(null, true);
  },
});

function dirFor(kind) {
  const dir = path.join(UPLOAD_DIR, kind);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Ambil waktu pemotretan dari data kamera (EXIF DateTimeOriginal/CreateDate) bila ada.
 * Waktu kamera tidak menyimpan zona waktu; jam & tanggal diambil apa adanya (waktu setempat kamera).
 * @returns {{time: string, date: string} | null}  time HH:MM, date YYYY-MM-DD
 */
async function exifDateTime(buffer) {
  try {
    const ex = await exifr.parse(buffer, ['DateTimeOriginal', 'CreateDate']);
    const d = ex && (ex.DateTimeOriginal || ex.CreateDate);
    if (d instanceof Date && !Number.isNaN(d.getTime())) {
      const p = (n) => String(n).padStart(2, '0');
      return { time: `${p(d.getHours())}:${p(d.getMinutes())}`, date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` };
    }
  } catch (_) { /* EXIF tidak wajib */ }
  return null;
}

async function exifTime(buffer) {
  const r = await exifDateTime(buffer);
  return r ? r.time : null;
}

/**
 * Proses ulang gambar: putar sesuai orientasi, perkecil, simpan sebagai JPEG.
 * Metadata (termasuk koordinat GPS di EXIF) dihapus. File berbahaya gagal di tahap decode.
 */
async function saveImage(kind, buffer, { maxSize = 1600, format = 'jpeg' } = {}) {
  let img;
  try {
    img = sharp(buffer, { failOn: 'error', limitInputPixels: 80e6 }).rotate();
    img = img.resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true });
    img = format === 'png' ? img.png({ compressionLevel: 9 }) : img.jpeg({ quality: 84, mozjpeg: true });
    buffer = await img.toBuffer();
  } catch (_) {
    throw badRequest('File gambar rusak atau formatnya tidak didukung (gunakan JPG/PNG; foto HEIC iPhone: '
      + 'Pengaturan > Kamera > Format > "Paling Kompatibel")');
  }
  const name = `${crypto.randomUUID()}.${format === 'png' ? 'png' : 'jpg'}`;
  await fs.promises.writeFile(path.join(dirFor(kind), name), buffer, { mode: 0o640 });
  return name;
}

/**
 * Tanda tangan: latar putih/terang (foto/scan kertas) dibuat transparan,
 * dipotong rapat ke goresan, disimpan sebagai PNG.
 */
async function saveSignature(buffer) {
  let out;
  try {
    const { data, info } = await sharp(buffer, { failOn: 'error', limitInputPixels: 40e6 })
      .rotate()
      .resize({ width: 900, height: 400, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum > 190 || data[i + 3] < 30) data[i + 3] = 0; else ink++;
    }
    if (ink < 50) throw new Error('kosong');
    out = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .trim({ threshold: 1 })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch (err) {
    throw badRequest(err.message === 'kosong'
      ? 'Tanda tangan tidak terbaca. Gunakan tinta gelap di atas kertas putih, atau gambar langsung di aplikasi.'
      : 'File gambar rusak atau formatnya tidak didukung');
  }
  const name = `${crypto.randomUUID()}.png`;
  await fs.promises.writeFile(path.join(dirFor('signatures'), name), out, { mode: 0o640 });
  return name;
}

function filePath(kind, name) {
  if (!/^[0-9a-f-]{36}\.(jpg|png)$/.test(name || '')) return null; // cegah path traversal
  return path.join(UPLOAD_DIR, kind, name);
}

async function removeFile(kind, name) {
  const p = filePath(kind, name);
  if (p) await fs.promises.unlink(p).catch(() => {});
}

/**
 * URL bertanda tangan berumur pendek, supaya <img> dan halaman cetak bisa dibuka
 * tanpa header Authorization (tag gambar & browser tidak bisa mengirim header).
 */
function signFile(kind, name, ttl = '2h') {
  if (!name) return null;
  const t = jwt.sign({ p: 'file', k: kind, n: name }, config.jwt.secret, { expiresIn: ttl, algorithm: 'HS256' });
  return `/api/files/${kind}/${name}?t=${encodeURIComponent(t)}`;
}

function signPrint(reportId, userId, lang) {
  return jwt.sign({ p: 'print', r: reportId, u: userId, l: lang }, config.jwt.secret, { expiresIn: '15m', algorithm: 'HS256' });
}

function verify(token, purpose) {
  try {
    const p = jwt.verify(token || '', config.jwt.secret, { algorithms: ['HS256'] });
    if (p.p !== purpose) throw new Error('purpose');
    return p;
  } catch (_) {
    throw unauthorized('Tautan sudah kedaluwarsa. Buka ulang dari aplikasi.');
  }
}

module.exports = { upload, saveImage, saveSignature, filePath, removeFile, signFile, signPrint, verify, exifTime, exifDateTime, UPLOAD_DIR };
