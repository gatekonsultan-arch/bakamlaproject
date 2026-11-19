import 'package:absensi_app/config.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('matriks hak akses menu sesuai backend (backend/src/roles.js)', () {
    expect(roleLabels.length, 7);
    expect(canManageUsers('SUPERADMIN'), isTrue);
    expect(canManageUsers('ADMIN'), isTrue);
    expect(canManageUsers('LOGISTIK'), isFalse);
    expect(canViewReports('SITE_MANAGER'), isTrue);
    expect(canViewReports('LOGISTIK'), isFalse);
  });

  test('material: PM/SM input kebutuhan, Logistik ajukan & catat stok', () {
    expect(canPlanMaterials('PROJECT_MANAGER'), isTrue);
    expect(canPlanMaterials('SITE_MANAGER'), isTrue);
    expect(canPlanMaterials('LOGISTIK'), isFalse);
    expect(canRequestPurchase('LOGISTIK'), isTrue);
    expect(canRequestPurchase('PROJECT_MANAGER'), isFalse);
    expect(canHandleStock('LOGISTIK'), isTrue);
    expect(canViewMaterials('HSE_OFFICER'), isFalse);
  });

  test('laporan K3: HSE Officer menyusun', () {
    expect(canWriteHseReports('HSE_OFFICER'), isTrue);
    expect(canWriteHseReports('SITE_MANAGER'), isFalse);
    expect(canViewHseReports('SITE_MANAGER'), isTrue);
    expect(canViewHseReports('LOGISTIK'), isFalse);
  });

  test('tenaga kerja: Site Manager mengabsen, upah tidak terlihat Logistik/HSE', () {
    expect(canRecordWorkerAttendance('SITE_MANAGER'), isTrue);
    expect(canRecordWorkerAttendance('PROJECT_MANAGER'), isFalse);
    expect(canViewWorkers('PROJECT_MANAGER'), isTrue);
    expect(canViewWorkers('LOGISTIK'), isFalse);
    expect(canViewWorkers('HSE_OFFICER'), isFalse);
  });

  test('ATP: Site Manager menyusun, PM menyetujui, HSE/Logistik tidak', () {
    expect(canWriteAtp('SITE_MANAGER'), isTrue);
    expect(canWriteAtp('PROJECT_MANAGER'), isFalse);
    expect(canViewAtp('PROJECT_MANAGER'), isTrue);
    expect(canViewAtp('HSE_OFFICER'), isFalse);
    expect(canViewAtp('LOGISTIK'), isFalse);
  });

  test('approval absen luar area: PM & Site Manager', () {
    expect(canApproveAttendance('PROJECT_MANAGER'), isTrue);
    expect(canApproveAttendance('SITE_MANAGER'), isTrue);
    expect(canApproveAttendance('SUPERADMIN'), isTrue);
    expect(canApproveAttendance('HSE_MANAGER'), isFalse);
    expect(canApproveAttendance('LOGISTIK'), isFalse);
  });
}
