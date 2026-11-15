import 'package:absensi_app/config.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('matriks hak akses menu sesuai backend', () {
    expect(canManageUsers('SUPERADMIN'), isTrue);
    expect(canManageUsers('ADMIN'), isTrue);
    expect(canManageUsers('LOGISTIK'), isFalse);
    expect(canViewReports('SITE_MANAGER'), isTrue);
    expect(canViewReports('HSE_MANAGER'), isTrue);
    expect(canViewReports('PROJECT_MANAGER'), isTrue);
    expect(canViewReports('LOGISTIK'), isFalse);
    expect(roleLabels.length, 6);
  });
}
