'use strict';
/**
 * Menjalankan file SQL di folder database/ secara berurutan.
 * Aman dijalankan berulang: objek/data yang sudah ada dilewati.
 *   npm run migrate
 */
const fs = require('fs');
const path = require('path');
const oracledb = require('oracledb');
require('dotenv').config();

const SQL_DIR = process.env.SQL_DIR || path.join(__dirname, '..', '..', 'database');
// ORA-00955 nama sudah dipakai, ORA-01408 index sudah ada, ORA-00001 data duplikat,
// ORA-02275 constraint sudah ada, ORA-01430 kolom sudah ada, ORA-02264 nama constraint sudah dipakai
const IGNORABLE = new Set([955, 1408, 1, 2275, 1430, 2264]);

function splitStatements(sql) {
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const conn = await oracledb.getConnection({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: process.env.DB_CONNECT_STRING,
  });
  try {
    const files = fs.readdirSync(SQL_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const stmts = splitStatements(fs.readFileSync(path.join(SQL_DIR, file), 'utf8'));
      let applied = 0;
      let skipped = 0;
      for (const stmt of stmts) {
        try {
          await conn.execute(stmt);
          applied++;
        } catch (err) {
          if (IGNORABLE.has(err.errorNum)) { skipped++; continue; }
          console.error(`\nGagal di ${file}:\n${stmt}\n`);
          throw err;
        }
      }
      await conn.commit();
      console.log(`${file}: ${applied} dijalankan, ${skipped} sudah ada`);
    }
    console.log('Migrasi selesai.');
  } finally {
    await conn.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
