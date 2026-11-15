'use strict';
const config = require('./config');
const db = require('./db');
const app = require('./app');

async function main() {
  await db.init();
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
