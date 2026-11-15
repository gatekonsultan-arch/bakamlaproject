import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../main.dart';
import '../models/models.dart';
import '../services/api.dart';
import '../services/location.dart';
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

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final r = await _api.get('/attendance/today');
      final a = r['attendance'];
      setState(() => _today = a == null ? null : Attendance.fromJson(a as Map<String, dynamic>));
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Persetujuan foto wajah (UU PDP) — diminta sekali saja.
  Future<bool> _ensureConsent() async {
    final c = await _api.get('/attendance/face-consent');
    if (c['required'] != true || c['consentedAt'] != null) return true;
    if (!mounted) return false;
    var agree = false;
    final ok = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: const Text('Persetujuan Foto Wajah'),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Absensi memerlukan selfie wajah setiap kali check-in dan check-out.'),
            const SizedBox(height: 8),
            Text('${c['text']}', style: const TextStyle(fontSize: 13)),
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
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Batal')),
            FilledButton(onPressed: () => agree ? Navigator.pop(ctx, true) : null, child: const Text('Lanjut')),
          ],
        ),
      ),
    );
    if (ok != true) return false;
    await _api.post('/attendance/face-consent', {'agree': true});
    return true;
  }

  Future<XFile?> _takeSelfie() => ImagePicker().pickImage(
        source: ImageSource.camera,
        preferredCameraDevice: CameraDevice.front,
        maxWidth: 1280,
        imageQuality: 85,
      );

  Future<void> _submit(bool checkIn) async {
    setState(() {
      _busy = true;
      _lastError = null;
      _status = 'Memeriksa persetujuan foto wajah...';
    });
    try {
      if (!await _ensureConsent()) return;
      setState(() => _status = 'Mengambil lokasi GPS...');
      final pos = await LocationService.current();
      setState(() => _status = 'Lokasi didapat (akurasi ${pos.accuracy.round()} m). Ambil selfie wajah Anda...');
      final photo = await _takeSelfie();
      if (photo == null) {
        setState(() => _lastError = 'Selfie dibatalkan. Absen membutuhkan foto wajah.');
        return;
      }
      setState(() => _status = 'Memeriksa wajah & mengirim ke server...');
      final fields = LocationService.toPayload(pos, note: _note.text).map((k, v) => MapEntry(k, '$v'));
      final r = await _api.upload(
        checkIn ? '/attendance/check-in' : '/attendance/check-out',
        [(field: 'photo', filename: photo.name.isEmpty ? 'selfie.jpg' : photo.name, bytes: await photo.readAsBytes())],
        fields: fields,
      );
      _note.clear();
      setState(() => _today = Attendance.fromJson(r['attendance'] as Map<String, dynamic>));
      if (mounted) showSnack(context, r['message'] as String? ?? 'Berhasil');
    } catch (e) {
      var msg = e.toString();
      if (e is ApiException && e.data['code'] == 'FACE_REJECTED') msg = '$msg Silakan coba lagi.';
      if (mounted) setState(() => _lastError = msg);
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
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
                FilledButton.icon(
                  onPressed: _busy ? null : () => _submit(t == null),
                  icon: Icon(t == null ? Icons.login : Icons.logout),
                  label: Text(t == null ? 'Check-in (GPS + Selfie)' : 'Check-out (GPS + Selfie)'),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(56),
                    backgroundColor: t == null ? null : cs.tertiary,
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
                'Absensi hanya diterima jika Anda berada di dalam radius lokasi kerja, akurasi GPS cukup baik, '
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
