DateTime? _date(dynamic v) => v == null ? null : DateTime.parse(v as String).toLocal();
double? _num(dynamic v) => v == null ? null : (v as num).toDouble();

class AppUser {
  final int id;
  final String username;
  final String fullName;
  final String? email;
  final String? phone;
  final String role;
  final String roleName;
  final int? siteId;
  final String? siteName;
  final bool isActive;

  AppUser({
    required this.id,
    required this.username,
    required this.fullName,
    this.email,
    this.phone,
    required this.role,
    required this.roleName,
    this.siteId,
    this.siteName,
    this.isActive = true,
  });

  factory AppUser.fromJson(Map<String, dynamic> j) => AppUser(
        id: j['id'] as int,
        username: j['username'] as String,
        fullName: j['fullName'] as String,
        email: j['email'] as String?,
        phone: j['phone'] as String?,
        role: j['role'] as String,
        roleName: (j['roleName'] ?? j['role']) as String,
        siteId: j['siteId'] as int?,
        siteName: j['siteName'] as String?,
        isActive: (j['isActive'] ?? true) as bool,
      );
}

class Site {
  final int id;
  final String name;
  final String? address;
  final double latitude;
  final double longitude;
  final int radiusM;
  final bool isActive;

  Site({
    required this.id,
    required this.name,
    this.address,
    required this.latitude,
    required this.longitude,
    required this.radiusM,
    required this.isActive,
  });

  factory Site.fromJson(Map<String, dynamic> j) => Site(
        id: j['id'] as int,
        name: j['name'] as String,
        address: j['address'] as String?,
        latitude: _num(j['latitude'])!,
        longitude: _num(j['longitude'])!,
        radiusM: j['radiusM'] as int,
        isActive: j['isActive'] as bool,
      );
}

class GeoPoint {
  final DateTime at;
  final double latitude;
  final double longitude;
  final double? accuracy;
  final double? distanceM;
  final String? photoUrl;

  /// Absen dilakukan di luar radius lokasi kerja (perlu persetujuan PM / Site Manager).
  final bool outside;

  /// Keterangan karyawan saat absen di luar area.
  final String? reason;

  GeoPoint(this.at, this.latitude, this.longitude, this.accuracy, this.distanceM,
      [this.photoUrl, this.outside = false, this.reason]);

  static GeoPoint? fromJson(Map<String, dynamic>? j) => j == null || j['at'] == null
      ? null
      : GeoPoint(_date(j['at'])!, _num(j['latitude'])!, _num(j['longitude'])!,
          _num(j['accuracy']), _num(j['distanceM']), j['photoUrl'] as String?,
          j['outside'] == true, j['reason'] as String?);
}

/// Status pengakuan kehadiran: PENDING (absen di luar area, menunggu), APPROVED, REJECTED.
class Approval {
  final String status;
  final String label;
  final String? byName;
  final String? byRole;
  final DateTime? at;
  final String? note;

  const Approval(this.status, this.label, {this.byName, this.byRole, this.at, this.note});

  static Approval fromJson(Map<String, dynamic>? j) => j == null
      ? const Approval('APPROVED', 'Diakui hadir')
      : Approval(j['status'] as String, j['label'] as String,
          byName: j['byName'] as String?,
          byRole: j['byRole'] as String?,
          at: _date(j['at']),
          note: j['note'] as String?);

  bool get pending => status == 'PENDING';
  bool get rejected => status == 'REJECTED';
}

class Attendance {
  final int id;
  final int userId;
  final String fullName;
  final String roleName;
  final String siteName;
  final String date;
  final GeoPoint checkIn;
  final GeoPoint? checkOut;
  final String? note;
  final int? siteRadiusM;
  final Approval approval;

  /// Hanya dari daftar approval: user ini boleh menyetujui / menolak.
  final bool canDecide;

  Attendance({
    required this.id,
    required this.userId,
    required this.fullName,
    required this.roleName,
    required this.siteName,
    required this.date,
    required this.checkIn,
    this.checkOut,
    this.note,
    this.siteRadiusM,
    this.approval = const Approval('APPROVED', 'Diakui hadir'),
    this.canDecide = false,
  });

  factory Attendance.fromJson(Map<String, dynamic> j) => Attendance(
        id: j['id'] as int,
        userId: j['userId'] as int,
        fullName: j['fullName'] as String,
        roleName: j['roleName'] as String,
        siteName: j['siteName'] as String,
        date: j['date'] as String,
        checkIn: GeoPoint.fromJson(j['checkIn'] as Map<String, dynamic>)!,
        checkOut: GeoPoint.fromJson(j['checkOut'] as Map<String, dynamic>?),
        note: j['note'] as String?,
        siteRadiusM: j['siteRadiusM'] as int?,
        approval: Approval.fromJson(j['approval'] as Map<String, dynamic>?),
        canDecide: j['canDecide'] == true,
      );

  bool get outside => checkIn.outside || (checkOut?.outside ?? false);

  Duration? get workDuration => checkOut?.at.difference(checkIn.at);
}
