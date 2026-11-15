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
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)) {
      return cb(badRequest('Hanya file gambar JPG, PNG, WEBP, atau HEIC yang diizinkan'));
    }
    cb(null, true);
  },
});

function dirFor(kind) {
  const dir = path.join(UPLOAD_DIR, kind);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Ambil jam pengambilan foto dari EXIF (HH:MM) bila ada. */
async function exifTime(buffer) {
  try {
    const ex = await exifr.parse(buffer, ['DateTimeOriginal', 'CreateDate']);
    const d = ex && (ex.DateTimeOriginal || ex.CreateDate);
    if (d instanceof Date && !Number.isNaN(d.getTime())) {
      // exifr membaca waktu kamera sebagai waktu lokal tanpa zona; ambil jam-menitnya apa adanya.
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
  } catch (_) { /* EXIF tidak wajib */ }
  return null;
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
    throw badRequest('File gambar rusak atau formatnya tidak didukung');
  }
  const name = `${crypto.randomUUID()}.${format === 'png' ? 'png' : 'jpg'}`;
  await fs.promises.writeFile(path.join(dirFor(kind), name), buffer, { mode: 0o640 });
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

module.exports = { upload, saveImage, filePath, removeFile, signFile, signPrint, verify, exifTime, UPLOAD_DIR };
