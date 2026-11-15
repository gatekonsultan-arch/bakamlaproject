'use strict';
/**
 * Membuat akun Super Admin pertama.
 *   SUPERADMIN_USERNAME=superadmin SUPERADMIN_PASSWORD='...' SUPERADMIN_NAME='Nama' npm run create-superadmin
 * Password tidak pernah disimpan di kode atau file SQL.
 */
const bcrypt = require('bcryptjs');
const oracledb = require('oracledb');
require('dotenv').config();

async function main() {
  const username = (process.env.SUPERADMIN_USERNAME || 'superadmin').toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD;
  const fullName = process.env.SUPERADMIN_NAME || 'Super Admin';
  if (!password || password.length < 12 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error('SUPERADMIN_PASSWORD wajib diisi: minimal 12 karakter, berisi huruf dan angka');
  }

  const conn = await oracledb.getConnection({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: process.env.DB_CONNECT_STRING,
  });
  try {
    const hash = await bcrypt.hash(password, 12);
    const r = await conn.execute(
      `MERGE INTO users u
       USING (SELECT :username AS username FROM dual) s ON (u.username = s.username)
       WHEN MATCHED THEN UPDATE SET password_hash = :hash, is_active = 1,
            failed_logins = 0, locked_until = NULL, token_version = u.token_version + 1,
            role_id = (SELECT id FROM roles WHERE code = 'SUPERADMIN')
       WHEN NOT MATCHED THEN INSERT (username, full_name, password_hash, role_id)
            VALUES (:username, :fullName, :hash, (SELECT id FROM roles WHERE code = 'SUPERADMIN'))`,
      { username, fullName, hash },
    );
    await conn.commit();
    console.log(`Super Admin "${username}" siap (${r.rowsAffected} baris).`);
  } finally {
    await conn.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
