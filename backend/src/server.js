'use strict';
const config = require('./config');
const db = require('./db');
const app = require('./app');

async function main() {
  await db.init();
  // Muat model deteksi wajah lebih awal agar check-in pertama tidak lambat.
  if (config.requireSelfie) require('./utils/face').init().catch((e) => console.error('Model wajah gagal dimuat:', e.message));
  // Hapus foto selfie yang melewati masa simpan: saat start & tiap 6 jam.
  const { purgeFacePhotos } = require('./utils/purgeFacePhotos');
  const purge = () => purgeFacePhotos()
    .then((r) => r.photosPurged && console.log(`Purge foto selfie: ${r.photosPurged} absensi`))
    .catch((e) => console.error('Purge foto selfie gagal:', e.message));
  setTimeout(purge, 30 * 1000).unref();
  setInterval(purge, 6 * 60 * 60 * 1000).unref();
  const server = app.listen(config.port, () => {
    console.log(`API absensi berjalan di port ${config.port} (${config.env})`);
  });

  const shutdown = async (signal) => {
    console.log(`${signal} diterima, mematikan server...`);
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 15000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Gagal menjalankan server:', err);
  process.exit(1);
});
