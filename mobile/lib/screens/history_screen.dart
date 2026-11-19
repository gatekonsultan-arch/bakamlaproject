import 'package:flutter/material.dart';

import '../models/models.dart';
import '../services/api.dart';
import '../widgets/common.dart';

class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key});
  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  List<Attendance> _items = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final r = await Api.instance.get('/attendance/me');
      setState(() => _items = (r['attendance'] as List)
          .map((e) => Attendance.fromJson(e as Map<String, dynamic>))
          .toList());
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    return RefreshIndicator(
      onRefresh: _load,
      child: _items.isEmpty
          ? ListView(children: const [
              EmptyState(icon: Icons.history, text: 'Belum ada riwayat absensi 30 hari terakhir.')
            ])
          : ListView.separated(
              padding: const EdgeInsets.all(8),
              itemCount: _items.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (context, i) {
                final a = _items[i];
                return Constrained(
                  child: ListTile(
                    leading: Icon(a.checkOut == null ? Icons.timelapse : Icons.check_circle_outline),
                    title: Row(children: [
                      Flexible(child: Text(fmtDate.format(DateTime.parse(a.date)))),
                      if (a.outside || a.approval.status != 'APPROVED') ...[
                        const SizedBox(width: 8),
                        ApprovalBadge(a.approval.status, a.approval.label),
                      ],
                    ]),
                    subtitle: Text(
                        '${a.siteName}${a.outside ? ' (di luar area)' : ''}\nMasuk ${fmtTime.format(a.checkIn.at)}  •  Pulang ${a.checkOut == null ? '-' : fmtTime.format(a.checkOut!.at)}'
                        '${a.approval.note != null ? '\nCatatan: ${a.approval.note}' : ''}'),
                    isThreeLine: true,
                    trailing: a.workDuration == null ? null : Text(formatDuration(a.workDuration!)),
                  ),
                );
              },
            ),
    );
  }
}
