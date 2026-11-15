import 'package:flutter/material.dart';

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

  Future<void> _submit(bool checkIn) async {
    setState(() {
      _busy = true;
      _lastError = null;
      _status = 'Mengambil lokasi GPS...';
    });
    try {
      final pos = await LocationService.current();
      setState(() => _status =
          'Lokasi didapat (akurasi ${pos.accuracy.round()} m). Mengirim ke server...');
      final r = await _api.post(
        checkIn ? '/attendance/check-in' : '/attendance/check-out',
        LocationService.toPayload(pos, note: _note.text),
      );
      _note.clear();
      setState(() => _today = Attendance.fromJson(r['attendance'] as Map<String, dynamic>));
      if (mounted) showSnack(context, r['message'] as String? ?? 'Berhasil');
    } catch (e) {
      setState(() => _lastError = e.toString());
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
                  label: Text(t == null ? 'Check-in Sekarang' : 'Check-out Sekarang'),
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
                'Absensi hanya diterima jika Anda berada di dalam radius lokasi kerja, '
                'akurasi GPS cukup baik, dan tidak menggunakan aplikasi pemalsu lokasi.',
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
        ]),
      ),
    );
  }
}
