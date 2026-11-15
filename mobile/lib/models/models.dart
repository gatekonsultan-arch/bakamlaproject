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

  GeoPoint(this.at, this.latitude, this.longitude, this.accuracy, this.distanceM);

  static GeoPoint? fromJson(Map<String, dynamic>? j) => j == null || j['at'] == null
      ? null
      : GeoPoint(_date(j['at'])!, _num(j['latitude'])!, _num(j['longitude'])!,
          _num(j['accuracy']), _num(j['distanceM']));
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
      );

  Duration? get workDuration => checkOut?.at.difference(checkIn.at);
}
