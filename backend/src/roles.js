'use strict';

const ROLES = Object.freeze({
  SUPERADMIN: 'SUPERADMIN',
  ADMIN: 'ADMIN',
  LOGISTIK: 'LOGISTIK',
  SITE_MANAGER: 'SITE_MANAGER',
  HSE_MANAGER: 'HSE_MANAGER',
  PROJECT_MANAGER: 'PROJECT_MANAGER',
});

const ALL_ROLES = Object.values(ROLES);

/**
 * Matriks hak akses.
 *  - Semua role dapat login dan melakukan absensi untuk dirinya sendiri.
 *  - Superadmin  : semua akses, termasuk mengelola admin lain.
 *  - Admin       : kelola user (kecuali superadmin), kelola lokasi, lihat semua laporan.
 *  - Project / Site / HSE Manager : lihat laporan absensi (Site Manager hanya lokasinya).
 *  - Logistik    : hanya absensi & riwayat milik sendiri.
 */
const PERMISSIONS = Object.freeze({
  manageUsers: [ROLES.SUPERADMIN, ROLES.ADMIN],
  manageSites: [ROLES.SUPERADMIN, ROLES.ADMIN],
  viewReports: [
    ROLES.SUPERADMIN,
    ROLES.ADMIN,
    ROLES.PROJECT_MANAGER,
    ROLES.SITE_MANAGER,
    ROLES.HSE_MANAGER,
  ],
});

/** Role yang laporannya dibatasi hanya untuk lokasi (site) miliknya. */
const SITE_SCOPED_REPORT_ROLES = [ROLES.SITE_MANAGER];

function can(role, permission) {
  return (PERMISSIONS[permission] || []).includes(role);
}

module.exports = { ROLES, ALL_ROLES, PERMISSIONS, SITE_SCOPED_REPORT_ROLES, can };
