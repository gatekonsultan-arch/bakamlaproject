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
  'PROJECT_MANAGER': 'Project Manager',
};

/// Sama dengan matriks hak akses di backend (backend/src/roles.js).
/// Ini hanya untuk menampilkan menu; keamanan tetap diperiksa di server.
bool canManageUsers(String role) => role == 'SUPERADMIN' || role == 'ADMIN';
bool canManageSites(String role) => role == 'SUPERADMIN' || role == 'ADMIN';
bool canViewReports(String role) => const {
      'SUPERADMIN', 'ADMIN', 'PROJECT_MANAGER', 'SITE_MANAGER', 'HSE_MANAGER'
    }.contains(role);
