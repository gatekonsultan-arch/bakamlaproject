'use strict';
/**
 * Deteksi wajah di server untuk selfie absensi.
 * Memakai @vladmandic/face-api (model SSD MobileNet v1) dengan backend TensorFlow.js WebAssembly:
 * tanpa komponen native, berjalan di Docker Alpine / VPS biasa (± 0,3–1 detik per foto).
 * Yang dicek: ada TEPAT SATU wajah, cukup besar (selfie, bukan foto dari jauh), dan cukup jelas.
 * Catatan: ini BUKAN pengenalan identitas — foto disimpan sebagai bukti untuk diperiksa atasan.
 */
const path = require('path');
const sharp = require('sharp');

let ready = null;
let faceapi = null;
let tf = null;

const MIN_SCORE = parseFloat(process.env.FACE_MIN_SCORE || '0.6');
// Lebar kotak wajah minimal (proporsi sisi terpendek foto) agar tergolong selfie.
const MIN_FACE_RATIO = parseFloat(process.env.FACE_MIN_RATIO || '0.15');
const MAX_SIDE = 640;

async function init() {
  if (!ready) {
    ready = (async () => {
      faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js');
      tf = faceapi.tf;
      const wasm = require('@tensorflow/tfjs-backend-wasm');
      wasm.setWasmPaths(`${path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm'))}/`);
      await tf.setBackend('wasm');
      await tf.ready();
      const modelDir = path.join(path.dirname(require.resolve('@vladmandic/face-api/package.json')), 'model');
      await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelDir);
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

/**
 * @returns {{ok: boolean, faces: number, score: number|null, ratio: number|null, reason: string|null}}
 */
async function checkSelfie(buffer) {
  await init();
  const { data, info } = await sharp(buffer, { failOn: 'error', limitInputPixels: 80e6 })
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const tensor = tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3]);
  let dets;
  try {
    dets = await faceapi.detectAllFaces(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4, maxResults: 10 }));
  } finally {
    tensor.dispose();
  }
  const faces = dets.filter((d) => d.score >= MIN_SCORE);
  const short = Math.min(info.width, info.height);
  if (faces.length === 0) {
    return { ok: false, faces: 0, score: dets[0]?.score ?? null, ratio: null, reason: 'Wajah tidak terdeteksi. Pastikan wajah terlihat jelas, menghadap kamera, dan pencahayaan cukup.' };
  }
  if (faces.length > 1) {
    return { ok: false, faces: faces.length, score: null, ratio: null, reason: `Terdeteksi ${faces.length} wajah. Selfie absensi harus berisi wajah Anda sendiri saja.` };
  }
  const f = faces[0];
  const ratio = Math.round((f.box.width / short) * 1000) / 1000;
  if (ratio < MIN_FACE_RATIO) {
    return { ok: false, faces: 1, score: f.score, ratio, reason: 'Wajah terlalu kecil/jauh. Dekatkan kamera ke wajah Anda.' };
  }
  return { ok: true, faces: 1, score: Math.round(f.score * 1000) / 1000, ratio, reason: null };
}

module.exports = { init, checkSelfie };
