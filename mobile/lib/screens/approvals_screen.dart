import 'package:flutter/material.dart';

import '../models/models.dart';
import '../services/api.dart';
import '../widgets/common.dart';

/// Menu Approval (Project Manager & Site Manager): absen di luar area baru diakui hadir
/// setelah disetujui di sini. Site Manager hanya melihat lokasinya sendiri.
class ApprovalsScreen extends StatefulWidget {
  const ApprovalsScreen({super.key});
  @override
  State<ApprovalsScreen> createState() => _ApprovalsScreenState();
}

class _ApprovalsScreenState extends State<ApprovalsScreen> {
  static const _tabs = [('PENDING', 'Menunggu'), ('APPROVED', 'Disetujui'), ('REJECTED', 'Ditolak')];
  String _status = 'PENDING';
  List<Attendance> _items = [];
  int _pendingCount = 0;
  bool _loading = true;
  final Set<int> _busy = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final r = await Api.instance.get('/attendance/approvals?status=$_status');
      setState(() {
        _items = [for (final a in r['attendance'] as List) Attendance.fromJson(a as Map<String, dynamic>)];
        _pendingCount = r['pendingCount'] as int? ?? 0;
      });
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _decide(Attendance a, bool approve) async {
    final note = await _askNote(a, approve);
    if (note == null) return;
    setState(() => _busy.add(a.id));
    try {
      final r = await Api.instance.post('/attendance/${a.id}/decision', {
        'decision': approve ? 'APPROVE' : 'REJECT',
        if (note.isNotEmpty) 'note': note,
      });
      if (mounted) showSnack(context, r['message'] as String? ?? 'Tersimpan');
      await _load();
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busy.remove(a.id));
    }
  }

  /// Catatan keputusan: opsional saat menyetujui, wajib (min. 5 karakter) saat menolak.
  Future<String?> _askNote(Attendance a, bool approve) {
    final ctrl = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => StatefulBuilder(builder: (ctx, set) {
        final ok = approve || ctrl.text.trim().length >= 5;
        return AlertDialog(
          title: Text(approve ? 'Setujui absensi?' : 'Tolak absensi?'),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${a.fullName} · ${fmtDate.format(DateTime.parse(a.date))}'),
            const SizedBox(height: 4),
            Text(
              approve
                  ? 'Absensi akan diakui sebagai hadir.'
                  : 'Absensi tidak diakui sebagai hadir. Karyawan akan melihat alasan penolakan.',
              style: const TextStyle(fontSize: 13),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: ctrl,
              autofocus: !approve,
              maxLength: 500,
              maxLines: 3,
              minLines: 1,
              onChanged: (_) => set(() {}),
              decoration: InputDecoration(
                labelText: approve ? 'Catatan (opsional)' : 'Alasan penolakan (wajib)',
                border: const OutlineInputBorder(),
              ),
            ),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Batal')),
            FilledButton(
              style: approve ? null : FilledButton.styleFrom(backgroundColor: Theme.of(ctx).colorScheme.error),
              onPressed: ok ? () => Navigator.pop(ctx, ctrl.text.trim()) : null,
              child: Text(approve ? 'Setujui' : 'Tolak'),
            ),
          ],
        );
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
        child: Constrained(
          child: SegmentedButton<String>(
            segments: [
              for (final (code, label) in _tabs)
                ButtonSegment(
                  value: code,
                  label: Text(code == 'PENDING' && _pendingCount > 0 ? '$label ($_pendingCount)' : label),
                ),
            ],
            selected: {_status},
            showSelectedIcon: false,
            onSelectionChanged: (v) {
              setState(() => _status = v.first);
              _load();
            },
          ),
        ),
      ),
      Expanded(
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : RefreshIndicator(
                onRefresh: _load,
                child: _items.isEmpty
                    ? ListView(children: [
                        EmptyState(
                          icon: Icons.task_alt,
                          text: _status == 'PENDING'
                              ? 'Tidak ada absen di luar area yang menunggu persetujuan.'
                              : 'Belum ada data (30 hari terakhir).',
                        ),
                      ])
                    : ListView.builder(
                        padding: const EdgeInsets.all(8),
                        itemCount: _items.length,
                        itemBuilder: (context, i) => Constrained(
                          child: _ApprovalTile(
                            a: _items[i],
                            busy: _busy.contains(_items[i].id),
                            onDecide: (approve) => _decide(_items[i], approve),
                          ),
                        ),
                      ),
              ),
      ),
    ]);
  }
}

class _ApprovalTile extends StatelessWidget {
  final Attendance a;
  final bool busy;
  final void Function(bool approve) onDecide;
  const _ApprovalTile({required this.a, required this.busy, required this.onDecide});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(a.fullName, style: Theme.of(context).textTheme.titleMedium),
                Text('${a.roleName} · ${a.siteName}', style: TextStyle(color: cs.outline, fontSize: 13)),
                Text(fmtDate.format(DateTime.parse(a.date)), style: TextStyle(color: cs.outline, fontSize: 13)),
              ]),
            ),
            ApprovalBadge(a.approval.status, a.approval.label),
          ]),
          const Divider(height: 20),
          _PointRow(label: 'Masuk', p: a.checkIn, radiusM: a.siteRadiusM),
          if (a.checkOut != null) ...[
            const SizedBox(height: 10),
            _PointRow(label: 'Pulang', p: a.checkOut!, radiusM: a.siteRadiusM),
          ],
          if (a.approval.byName != null) ...[
            const SizedBox(height: 10),
            Text(
              '${a.approval.rejected ? 'Ditolak' : 'Disetujui'} oleh ${a.approval.byName}'
              '${a.approval.byRole != null ? ' (${a.approval.byRole})' : ''}'
              '${a.approval.at != null ? ' · ${fmtYmd.format(a.approval.at!)} ${fmtTime.format(a.approval.at!)}' : ''}'
              '${a.approval.note != null ? '\nCatatan: ${a.approval.note}' : ''}',
              style: const TextStyle(fontSize: 12),
            ),
          ],
          if (a.canDecide) ...[
            const SizedBox(height: 12),
            Row(mainAxisAlignment: MainAxisAlignment.end, children: [
              OutlinedButton.icon(
                onPressed: busy ? null : () => onDecide(false),
                icon: const Icon(Icons.close),
                label: const Text('Tolak'),
                style: OutlinedButton.styleFrom(foregroundColor: cs.error),
              ),
              const SizedBox(width: 8),
              FilledButton.icon(
                onPressed: busy ? null : () => onDecide(true),
                icon: const Icon(Icons.check),
                label: const Text('Setujui'),
              ),
            ]),
          ] else if (a.approval.pending)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Text(
                'Diputuskan oleh atasan lain (absensi Anda sendiri atau di luar kewenangan Anda).',
                style: TextStyle(color: cs.outline, fontSize: 12),
              ),
            ),
        ]),
      ),
    );
  }
}

/// Satu titik absen: jam, selfie, jarak dari lokasi, keterangan, dan tautan peta.
class _PointRow extends StatelessWidget {
  final String label;
  final GeoPoint p;
  final int? radiusM;
  const _PointRow({required this.label, required this.p, this.radiusM});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final dist = p.distanceM == null ? '-' : p.distanceM! >= 1000
        ? '${(p.distanceM! / 1000).toStringAsFixed(1)} km'
        : '${p.distanceM!.round()} m';
    return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (p.photoUrl != null)
        GestureDetector(
          onTap: () => showDialog(
            context: context,
            builder: (ctx) => Dialog(
              child: Image.network(Api.instance.abs(p.photoUrl), fit: BoxFit.contain),
            ),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Image.network(Api.instance.abs(p.photoUrl), width: 56, height: 56, fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => const SizedBox(width: 56, height: 56, child: Icon(Icons.person))),
          ),
        )
      else
        const SizedBox(width: 56, height: 56, child: Icon(Icons.person_outline)),
      const SizedBox(width: 12),
      Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('$label ${fmtTime.format(p.at)}', style: const TextStyle(fontWeight: FontWeight.w600)),
          Text(
            p.outside
                ? 'Di luar area · $dist dari lokasi${radiusM != null ? ' (radius $radiusM m)' : ''}'
                : 'Di dalam area · $dist dari lokasi',
            style: TextStyle(color: p.outside ? const Color(0xFFEF6C00) : cs.outline, fontSize: 13),
          ),
          if (p.reason != null) Text('Keterangan: ${p.reason}', style: const TextStyle(fontSize: 13)),
          TextButton.icon(
            style: TextButton.styleFrom(padding: EdgeInsets.zero, visualDensity: VisualDensity.compact),
            onPressed: () => openMap(p.latitude, p.longitude),
            icon: const Icon(Icons.map_outlined, size: 18),
            label: const Text('Lihat di peta'),
          ),
        ]),
      ),
    ]);
  }
}
