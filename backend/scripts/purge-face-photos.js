'use strict';
/** Jalankan manual: npm run purge-face-photos  (otomatis juga berjalan tiap 6 jam di server) */
const db = require('../src/db');
const { purgeFacePhotos } = require('../src/utils/purgeFacePhotos');

(async () => {
  await db.init();
  const r = await purgeFacePhotos();
  console.log(`Foto selfie dihapus: ${r.photosPurged} absensi, sidik foto dihapus: ${r.hashesPurged}`);
  await db.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
