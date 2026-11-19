import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../main.dart';
import '../models/models.dart';
import '../services/api.dart';
import '../services/location.dart';
import '../widgets/camera_input.dart';
import '../widgets/common.dart';

class AttendanceScreen extends StatefulWidget {
  const AttendanceScreen({super.key});
  @override
  State<AttendanceScreen> createState() => _AttendanceScreenState();
}

class _AttendanceScreenState extends State<AttendanceScreen> {
  final _api = Api.instance;
  final _note = TextEditingController();
  Attendance? _today;
  bool _loading = true;
  bool _busy = false;
  String? _status;
  String? _lastError;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  /// Status persetujuan foto wajah, dimuat SEBELUM tombol absen diketuk.
  /// Penting untuk iPhone: kamera web hanya boleh dibuka tepat saat pengguna mengetuk
  /// (Safari/Chrome iOS mengabaikan pembukaan kamera setelah menunggu jaringan/GPS).
  Map<String, dynamic>? _consent;

  /// Menandai percobaan absen yang sedang berjalan; dinaikkan saat dibatalkan.
  int _attempt = 0;
  bool _waitingCamera = false;

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final r = await Future.wait([_api.get('/attendance/today'), _api.get('/attendance/face-consent')]);
      final a = r[0]['attendance'];
      setState(() {
        _today = a == null ? null : Attendance.fromJson(a as Map<String, dynamic>);
        _consent = r[1];
      });
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  bool get _needConsent => _consent != null && _consent!['required'] == true && _consent!['consentedAt'] == null;

  /// Membuka kamera depan. HARUS dipanggil langsung dari handler ketukan (tanpa await sebelumnya).
  Future<XFile?> _takeSelfie() => ImagePicker().pickImage(
        source: ImageSource.camera,
        preferredCameraDevice: CameraDevice.front,
        maxWidth: 1280,
        imageQuality: 85,
      );

  /// Handler tombol absen: sinkron, kamera dibuka seketika.
  void _onAbsenPressed(bool checkIn) {
    setState(() => _lastError = null);
    if (_needConsent) {
      _askConsentThenCapture(checkIn);
      return;
    }
    _captureAndSubmit(checkIn, _takeSelfie());
  }

  /// Persetujuan foto wajah (UU PDP), sekali saja. Kamera dibuka oleh ketukan tombol "Lanjut".
  Future<void> _askConsentThenCapture(bool checkIn) async {
    var agree = false;
    final photo = await showDialog<Future<XFile?>>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: const Text('Persetujuan Foto Wajah'),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Absensi memerlukan selfie wajah setiap kali check-in dan check-out.'),
            const SizedBox(height: 8),
            Text('${_consent!['text']}', style: const TextStyle(fontSize: 13)),
            const SizedBox(height: 4),
            const Text('Dasar: UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi.', style: TextStyle(fontSize: 11)),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: agree,
              title: const Text('Saya setuju'),
              onChanged: (v) => set(() => agree = v ?? false),
            ),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Batal')),
            // Web (termasuk iPhone): tombol ini dilapisi input kamera HTML asli agar kamera pasti terbuka.
            NativeCameraOverlay(
              enabled: agree && nativeCameraSupported,
              onPicked: (bytes, name) => Navigator.pop(ctx, Future.value(XFile.fromData(bytes, name: name))),
              child: FilledButton(
                onPressed: agree ? () => Navigator.pop(ctx, _takeSelfie()) : null,
                child: const Text('Lanjut & ambil selfie'),
              ),
            ),
          ],
        ),
      ),
    );
    if (photo == null) return;
    try {
      await _api.post('/attendance/face-consent', {'agree': true});
      _consent = {...?_consent, 'consentedAt': DateTime.now().toIso8601String()};
    } catch (e) {
      if (mounted) setState(() => _lastError = e.toString());
      return;
    }
    await _captureAndSubmit(checkIn, photo);
  }

  /// Dialog keterangan absen di luar area. Mengembalikan keterangan, atau null bila batal.
  Future<String?> _askOutsideReason(bool checkIn, Map<String, dynamic> info) {
    final ctrl = TextEditingController();
    return showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => StatefulBuilder(builder: (ctx, set) {
        final text = ctrl.text.trim();
        return AlertDialog(
          title: Text(checkIn ? 'Check-in di luar area' : 'Check-out di luar area'),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Anda berada ${info['distanceM'] is num ? '${(info['distanceM'] as num).round()} m' : 'jauh'} dari '
                  '${info['siteName'] ?? 'lokasi kerja'} (radius ${info['radiusM'] ?? '-'} m).'),
              const SizedBox(height: 8),
              const Text('Absen tetap bisa dilakukan dengan keterangan, tetapi baru diakui hadir setelah '
                  'disetujui Project Manager atau Site Manager.',
                  style: TextStyle(fontSize: 13)),
              const SizedBox(height: 12),
              TextField(
                controller: ctrl,
                autofocus: true,
                maxLength: 500,
                minLines: 2,
                maxLines: 4,
                onChanged: (_) => set(() {}),
                decoration: const InputDecoration(
                  labelText: 'Keterangan (wajib)',
                  hintText: 'Contoh: Rapat koordinasi di kantor Bakamla Balikpapan',
                  border: OutlineInputBorder(),
                ),
              ),
              if (text.isNotEmpty && text.length < 10)
                const Text('Minimal 10 karakter: jelaskan lokasi & alasannya.',
                    style: TextStyle(fontSize: 12, color: Colors.red)),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Batal')),
            FilledButton(
              onPressed: text.length >= 10 ? () => Navigator.pop(ctx, text) : null,
              child: const Text('Kirim untuk disetujui'),
            ),
          ],
        );
      }),
    );
  }

  void _cancelAttempt() => setState(() {
        _attempt++;
        _busy = false;
        _waitingCamera = false;
        _status = null;
        _lastError = 'Absen dibatalkan.';
      });

  Future<void> _captureAndSubmit(bool checkIn, Future<XFile?> photoFuture) async {
    final attempt = ++_attempt;
    bool stale() => !mounted || attempt != _attempt;
    setState(() {
      _busy = true;
      _waitingCamera = true;
      _status = 'Ambil selfie wajah Anda...';
    });
    try {
      final photo = await photoFuture;
      if (stale()) return;
      setState(() => _waitingCamera = false);
      if (photo == null) {
        setState(() => _lastError = 'Selfie dibatalkan. Absen membutuhkan foto wajah.');
        return;
      }
      setState(() => _status = 'Mengambil lokasi GPS...');
      final pos = await LocationService.current();
      if (stale()) return;
      final hint = LocationService.accuracyHint(pos);
      if (hint != null) {
        setState(() => _lastError = hint);
        return;
      }
      setState(() => _status = 'Lokasi didapat (akurasi ${pos.accuracy.round()} m). Memeriksa wajah & mengirim...');
      final fields = LocationService.toPayload(pos, note: _note.text).map((k, v) => MapEntry(k, '$v'));
      final bytes = await photo.readAsBytes();
      final filename = photo.name.isEmpty ? 'selfie.jpg' : photo.name;
      Future<Map<String, dynamic>> send() => _api.upload(
            checkIn ? '/attendance/check-in' : '/attendance/check-out',
            [(field: 'photo', filename: filename, bytes: bytes)],
            fields: fields,
          );
      Map<String, dynamic> r;
      try {
        r = await send();
      } on ApiException catch (e) {
        if (e.data['code'] != 'OUTSIDE_AREA' || fields.containsKey('outsideReason')) rethrow;
        // Di luar area: boleh absen dengan keterangan, lalu menunggu persetujuan PM / Site Manager.
        if (stale()) return;
        setState(() => _status = 'Anda di luar area lokasi kerja. Isi keterangan...');
        final reason = await _askOutsideReason(checkIn, e.data);
        if (stale()) return;
        if (reason == null) {
          setState(() => _lastError = 'Absen dibatalkan. ${e.message}');
          return;
        }
        fields['outsideReason'] = reason;
        setState(() => _status = 'Mengirim absen di luar area...');
        r = await send();
      }
      if (stale()) return;
      _note.clear();
      setState(() => _today = Attendance.fromJson(r['attendance'] as Map<String, dynamic>));
      if (mounted) showSnack(context, r['message'] as String? ?? 'Berhasil');
    } catch (e) {
      if (stale()) return;
      var msg = e.toString();
      if (e is ApiException && e.data['code'] == 'FACE_REJECTED') msg = '$msg Silakan coba lagi.';
      if (e is ApiException && e.data['code'] == 'FACE_CONSENT_REQUIRED') {
        _consent = {...?_consent, 'required': true, 'consentedAt': null};
        msg = 'Persetujuan foto wajah diperlukan. Ketuk tombol absen lagi.';
      }
      setState(() => _lastError = msg);
    } finally {
      if (!stale()) {
        setState(() {
          _busy = false;
          _waitingCamera = false;
          _status = null;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final user = auth.user!;
    final t = _today;
    final done = t?.checkOut != null;

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(16), children: [
        Constrained(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(fmtDate.format(DateTime.now()), style: Theme.of(context).textTheme.titleMedium),
            Text(user.siteName != null
                ? 'Lokasi kerja: ${user.siteName}'
                : 'Lokasi kerja: otomatis (lokasi terdaftar terdekat)'),
            const SizedBox(height: 16),
            if (_loading)
              const Padding(
                  padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()))
            else ...[
              Row(children: [
                Expanded(child: _TimeCard(label: 'Masuk', point: t?.checkIn, icon: Icons.login)),
                const SizedBox(width: 12),
                Expanded(child: _TimeCard(label: 'Pulang', point: t?.checkOut, icon: Icons.logout)),
              ]),
              if (t != null) ...[
                if (t.outside || t.approval.status != 'APPROVED') ...[
                  const SizedBox(height: 12),
                  _ApprovalCard(t),
                ],
                const SizedBox(height: 8),
                Text('Lokasi absen: ${t.siteName}', style: TextStyle(color: cs.outline)),
                if (t.workDuration != null)
                  Text('Durasi kerja: ${formatDuration(t.workDuration!)}',
                      style: TextStyle(color: cs.outline)),
              ],
              const SizedBox(height: 24),
              if (!done) ...[
                TextField(
                  controller: _note,
                  maxLength: 255,
                  decoration: const InputDecoration(
                      labelText: 'Catatan (opsional)', border: OutlineInputBorder()),
                ),
                const SizedBox(height: 8),
                // Web: ketukan langsung mengenai input kamera HTML asli di atas tombol (wajib untuk iPhone).
                // Bila persetujuan foto wajah belum ada, tombol membuka dialog persetujuan dulu.
                NativeCameraOverlay(
                  enabled: nativeCameraSupported && !_busy && !_loading && !_needConsent,
                  onTapStart: () => setState(() => _lastError = null),
                  onPicked: (bytes, name) =>
                      _captureAndSubmit(t == null, Future.value(XFile.fromData(bytes, name: name))),
                  child: FilledButton.icon(
                    onPressed: _busy || _loading ? null : () => _onAbsenPressed(t == null),
                    icon: Icon(t == null ? Icons.login : Icons.logout),
                    label: Text(t == null ? 'Check-in (GPS + Selfie)' : 'Check-out (GPS + Selfie)'),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(56),
                      backgroundColor: t == null ? null : cs.tertiary,
                    ),
                  ),
                ),
              ] else
                Card(
                  color: cs.primaryContainer,
                  child: const Padding(
                    padding: EdgeInsets.all(16),
                    child: Row(children: [
                      Icon(Icons.check_circle),
                      SizedBox(width: 12),
                      Expanded(child: Text('Absensi hari ini sudah lengkap. Terima kasih!')),
                    ]),
                  ),
                ),
              if (_status != null) ...[
                const SizedBox(height: 16),
                Row(children: [
                  const SizedBox(
                      width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
                  const SizedBox(width: 12),
                  Expanded(child: Text(_status!)),
                  if (_waitingCamera) TextButton(onPressed: _cancelAttempt, child: const Text('Batalkan')),
                ]),
              ],
              if (_lastError != null) ...[
                const SizedBox(height: 16),
                Card(
                  color: cs.errorContainer,
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(children: [
                      Icon(Icons.error_outline, color: cs.onErrorContainer),
                      const SizedBox(width: 12),
                      Expanded(
                          child: Text(_lastError!, style: TextStyle(color: cs.onErrorContainer))),
                    ]),
                  ),
                ),
              ],
              const SizedBox(height: 24),
              Text(
                'Absensi langsung diakui jika Anda berada di dalam radius lokasi kerja. Di luar area, absen tetap bisa '
                'dengan keterangan dan baru diakui setelah disetujui Project Manager / Site Manager. '
                'Akurasi GPS harus cukup baik, '
                'tidak menggunakan aplikasi pemalsu lokasi, dan selfie berisi wajah Anda sendiri (satu wajah, terlihat jelas). '
                'Foto selfie dihapus otomatis setelah 90 hari.',
                style: TextStyle(color: cs.outline, fontSize: 12),
              ),
            ],
          ]),
        ),
      ]),
    );
  }
}

class _TimeCard extends StatelessWidget {
  final String label;
  final GeoPoint? point;
  final IconData icon;
  const _TimeCard({required this.label, required this.point, required this.icon});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [Icon(icon, size: 18), const SizedBox(width: 6), Text(label)]),
          const SizedBox(height: 8),
          Text(point == null ? '--:--' : fmtTime.format(point!.at),
              style: Theme.of(context).textTheme.headlineMedium),
          if (point?.distanceM != null)
            Text('${point!.distanceM!.round()} m dari titik lokasi',
                style: TextStyle(color: cs.outline, fontSize: 12)),
          if (point?.photoUrl != null) ...[
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.network(Api.instance.abs(point!.photoUrl), height: 72, width: 72, fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => const SizedBox.shrink()),
            ),
          ],
        ]),
      ),
    );
  }
}

/// Status pengakuan kehadiran untuk absen di luar area.
class _ApprovalCard extends StatelessWidget {
  final Attendance t;
  const _ApprovalCard(this.t);

  @override
  Widget build(BuildContext context) {
    final a = t.approval;
    final color = ApprovalBadge.colors[a.status] ?? Colors.grey;
    final (icon, title) = switch (a.status) {
      'PENDING' => (Icons.hourglass_top, 'Menunggu persetujuan Project Manager / Site Manager'),
      'REJECTED' => (Icons.cancel_outlined, 'Absensi ditolak — tidak diakui hadir'),
      _ => (Icons.verified_outlined, 'Absen di luar area telah disetujui — diakui hadir'),
    };
    return Card(
      color: Color.alphaBlend(color.withValues(alpha: 0.08), Theme.of(context).colorScheme.surface),
      elevation: 0,
      shape: RoundedRectangleBorder(
          side: BorderSide(color: color.withValues(alpha: 0.5)), borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(icon, color: color),
            const SizedBox(width: 10),
            Expanded(child: Text(title, style: TextStyle(color: color, fontWeight: FontWeight.w600))),
          ]),
          if (t.checkIn.outside) ...[
            const SizedBox(height: 8),
            Text('Keterangan masuk: ${t.checkIn.reason ?? '-'}'),
          ],
          if (t.checkOut?.outside == true) ...[
            const SizedBox(height: 4),
            Text('Keterangan pulang: ${t.checkOut!.reason ?? '-'}'),
          ],
          if (a.byName != null) ...[
            const SizedBox(height: 6),
            Text('${a.status == 'REJECTED' ? 'Ditolak' : 'Disetujui'} oleh ${a.byName}'
                '${a.byRole != null ? ' (${a.byRole})' : ''}${a.at != null ? ', ${fmtTime.format(a.at!)}' : ''}',
                style: const TextStyle(fontSize: 12)),
          ],
          if (a.note != null) Text('Catatan: ${a.note}', style: const TextStyle(fontSize: 12)),
        ]),
      ),
    );
  }
}
