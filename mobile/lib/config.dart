/// Alamat API. Atur saat build:
///   flutter build web --dart-define=API_URL=https://absensi.domainanda.com
///   flutter build apk --dart-define=API_URL=https://absensi.domainanda.com
/// Default kosong = API satu domain dengan aplikasi web (via Nginx).
const String apiBaseUrl = String.fromEnvironment('API_URL', defaultValue: '');

const Map<String, String> roleLabels = {
  'SUPERADMIN': 'Super Admin',
  'ADMIN': 'Admin',
  'LOGISTIK': 'Logistik',
  'SITE_MANAGER': 'Site Manager',
  'HSE_MANAGER': 'HSE Manager',
  'HSE_OFFICER': 'HSE Officer',
  'PROJECT_MANAGER': 'Project Manager',
};

/// Sama dengan matriks hak akses di backend (backend/src/roles.js).
/// Ini hanya untuk menampilkan menu; keamanan tetap diperiksa di server.
bool canManageUsers(String role) => role == 'SUPERADMIN' || role == 'ADMIN';
bool canManageSites(String role) => role == 'SUPERADMIN' || role == 'ADMIN';
bool canViewReports(String role) => const {
      'SUPERADMIN', 'ADMIN', 'PROJECT_MANAGER', 'SITE_MANAGER', 'HSE_MANAGER'
    }.contains(role);

bool _in(String role, Set<String> roles) => roles.contains(role);

// Persetujuan absen di luar area (Site Manager: lokasinya saja)
bool canApproveAttendance(String r) => _in(r, {'SUPERADMIN', 'PROJECT_MANAGER', 'SITE_MANAGER'});

// Material logistik
bool canViewMaterials(String r) =>
    _in(r, {'SUPERADMIN', 'ADMIN', 'PROJECT_MANAGER', 'SITE_MANAGER', 'LOGISTIK'});
bool canPlanMaterials(String r) => _in(r, {'SUPERADMIN', 'ADMIN', 'PROJECT_MANAGER', 'SITE_MANAGER'});
bool canRequestPurchase(String r) => _in(r, {'SUPERADMIN', 'LOGISTIK'});
bool canHandleStock(String r) => _in(r, {'SUPERADMIN', 'LOGISTIK'});

// Laporan Harian K3
bool canViewHseReports(String r) => _in(
    r, {'SUPERADMIN', 'ADMIN', 'PROJECT_MANAGER', 'SITE_MANAGER', 'HSE_MANAGER', 'HSE_OFFICER'});
bool canWriteHseReports(String r) => _in(r, {'SUPERADMIN', 'HSE_OFFICER', 'HSE_MANAGER'});
bool canManageReportSettings(String r) =>
    _in(r, {'SUPERADMIN', 'ADMIN', 'HSE_MANAGER', 'PROJECT_MANAGER'});

// Tenaga kerja harian (tukang, mandor, buruh) & upah
bool canViewWorkers(String r) => _in(r, {'SUPERADMIN', 'ADMIN', 'PROJECT_MANAGER', 'SITE_MANAGER'});
bool canManageWorkers(String r) => canViewWorkers(r);
bool canRecordWorkerAttendance(String r) => _in(r, {'SUPERADMIN', 'SITE_MANAGER'});
bool canRecordCashAdvance(String r) => _in(r, {'SUPERADMIN', 'ADMIN', 'SITE_MANAGER'});

// ATP Checklist (mutu pekerjaan struktur)
bool canViewAtp(String r) => _in(r, {'SUPERADMIN', 'ADMIN', 'PROJECT_MANAGER', 'SITE_MANAGER'});
bool canWriteAtp(String r) => _in(r, {'SUPERADMIN', 'SITE_MANAGER'});
