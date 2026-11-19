'use strict';

const ROLES = Object.freeze({
  SUPERADMIN: 'SUPERADMIN',
  ADMIN: 'ADMIN',
  LOGISTIK: 'LOGISTIK',
  SITE_MANAGER: 'SITE_MANAGER',
  HSE_MANAGER: 'HSE_MANAGER',
  HSE_OFFICER: 'HSE_OFFICER',
  PROJECT_MANAGER: 'PROJECT_MANAGER',
});

const ALL_ROLES = Object.values(ROLES);
const R = ROLES;

/**
 * Matriks hak akses (satu-satunya sumber kebenaran; aplikasi hanya menyembunyikan menu).
 *  - Semua role dapat login dan melakukan absensi untuk dirinya sendiri.
 *  - Superadmin : semua akses.  Admin : kelola user (kecuali superadmin/admin) & lokasi.
 *  - Material   : PM & SM input kebutuhan; Logistik ajukan PR, pesan, terima, catat pemakaian;
 *                 Project Manager meng-approve PR.
 *  - Laporan K3 : HSE Officer menyusun; Site Manager (PIC Site) mengetahui; HSE Manager menyetujui.
 */
const PERMISSIONS = Object.freeze({
  manageUsers: [R.SUPERADMIN, R.ADMIN],
  manageSites: [R.SUPERADMIN, R.ADMIN],
  viewReports: [R.SUPERADMIN, R.ADMIN, R.PROJECT_MANAGER, R.SITE_MANAGER, R.HSE_MANAGER],
  // Absen di luar area baru diakui hadir setelah disetujui PM / Site Manager (SM: lokasinya saja).
  approveAttendance: [R.SUPERADMIN, R.PROJECT_MANAGER, R.SITE_MANAGER],

  viewMaterials: [R.SUPERADMIN, R.ADMIN, R.PROJECT_MANAGER, R.SITE_MANAGER, R.LOGISTIK],
  planMaterials: [R.SUPERADMIN, R.ADMIN, R.PROJECT_MANAGER, R.SITE_MANAGER],
  requestPurchase: [R.SUPERADMIN, R.LOGISTIK],
  approvePurchase: [R.SUPERADMIN, R.PROJECT_MANAGER],
  handleStock: [R.SUPERADMIN, R.LOGISTIK],

  viewHseReports: [R.SUPERADMIN, R.ADMIN, R.PROJECT_MANAGER, R.SITE_MANAGER, R.HSE_MANAGER, R.HSE_OFFICER],
  writeHseReports: [R.SUPERADMIN, R.HSE_OFFICER, R.HSE_MANAGER],
  acknowledgeHseReports: [R.SUPERADMIN, R.SITE_MANAGER],
  approveHseReports: [R.SUPERADMIN, R.HSE_MANAGER],
  manageReportSettings: [R.SUPERADMIN, R.ADMIN, R.HSE_MANAGER, R.PROJECT_MANAGER],

  // Tenaga kerja harian (tukang, mandor, buruh) & upah
  viewWorkers: [R.SUPERADMIN, R.ADMIN, R.PROJECT_MANAGER, R.SITE_MANAGER],
  manageWorkers: [R.SUPERADMIN, R.ADMIN, R.PROJECT_MANAGER, R.SITE_MANAGER],
  recordWorkerAttendance: [R.SUPERADMIN, R.SITE_MANAGER],
  recordCashAdvance: [R.SUPERADMIN, R.ADMIN, R.SITE_MANAGER],
  submitPayroll: [R.SUPERADMIN, R.SITE_MANAGER],
  approvePayroll: [R.SUPERADMIN, R.PROJECT_MANAGER],
  markPayrollPaid: [R.SUPERADMIN, R.ADMIN, R.PROJECT_MANAGER],

  // ATP Checklist (mutu pekerjaan struktur)
  viewAtp: [R.SUPERADMIN, R.ADMIN, R.PROJECT_MANAGER, R.SITE_MANAGER],
  writeAtp: [R.SUPERADMIN, R.SITE_MANAGER],
  approveAtp: [R.SUPERADMIN, R.PROJECT_MANAGER],
});

/** Role yang aksesnya dibatasi ke lokasi (site) miliknya bila user ditugaskan ke satu site. */
const SITE_SCOPED_ROLES = [R.SITE_MANAGER, R.LOGISTIK, R.HSE_OFFICER];
/** Untuk laporan absensi: Site Manager selalu dibatasi ke site-nya. */
const SITE_SCOPED_REPORT_ROLES = [R.SITE_MANAGER];

function can(role, permission) {
  return (PERMISSIONS[permission] || []).includes(role);
}

/** Site yang boleh diakses user: null = semua site. */
function siteScope(user) {
  return SITE_SCOPED_ROLES.includes(user.roleCode) && user.siteId ? user.siteId : null;
}

module.exports = {
  ROLES, ALL_ROLES, PERMISSIONS, SITE_SCOPED_ROLES, SITE_SCOPED_REPORT_ROLES, can, siteScope,
};
