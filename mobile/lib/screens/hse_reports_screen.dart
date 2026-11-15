import 'package:flutter/material.dart';

import '../config.dart';
import '../main.dart';
import '../services/api.dart';
import '../widgets/common.dart';
import '../widgets/site_picker.dart';
import 'hse_report_editor.dart';
import 'hse_settings_screen.dart';

const hseStatusColors = {
  'DRAFT': Color(0xFF757575),
  'SUBMITTED': Color(0xFFF9A825),
  'ACKNOWLEDGED': Color(0xFF1565C0),
  'APPROVED': Color(0xFF2E7D32),
  'REVISION': Color(0xFFD32F2F),
};

class HseReportsScreen extends StatefulWidget {
  const HseReportsScreen({super.key});
  @override
  State<HseReportsScreen> createState() => _HseReportsScreenState();
}

class _HseReportsScreenState extends State<HseReportsScreen> {
  int? _siteId;
  String? _status;
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final r = await Api.instance.get('/hse-reports', query: {
        if (_siteId != null) 'siteId': '$_siteId',
        if (_status != null) 'status': _status!,
      });
      setState(() => _items = (r['reports'] as List).cast<Map<String, dynamic>>());
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _create() async {
    int? siteId = _siteId ?? auth.user!.siteId;
    DateTime date = DateTime.now();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: const Text('Buat Laporan Harian K3'),
          content: SizedBox(
            width: 380,
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              SitePicker(value: siteId, allowAll: false, onChanged: (v) => set(() => siteId = v)),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                icon: const Icon(Icons.event),
                label: Text(fmtDate.format(date)),
                onPressed: () async {
                  final d = await showDatePicker(
                      context: ctx, firstDate: DateTime(2024), lastDate: DateTime.now(), initialDate: date);
                  if (d != null) set(() => date = d);
                },
              ),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Batal')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Buat')),
          ],
        ),
      ),
    );
    if (ok != true || siteId == null) return;
    try {
      final r = await Api.instance.post('/hse-reports', {'siteId': siteId, 'date': fmtYmd.format(date)});
      if (!mounted) return;
      await Navigator.push(context, MaterialPageRoute(builder: (_) => HseReportEditor(id: r['id'] as int)));
      _load();
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final role = auth.user!.role;
    return Scaffold(
      floatingActionButton: canWriteHseReports(role)
          ? FloatingActionButton.extended(
              onPressed: _create, icon: const Icon(Icons.note_add), label: const Text('Buat Laporan'))
          : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.fromLTRB(12, 12, 12, 88), children: [
          Constrained(
            maxWidth: 960,
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(children: [
                Expanded(
                  child: SitePicker(value: _siteId, onChanged: (v) {
                    setState(() => _siteId = v);
                    _load();
                  }),
                ),
                if (canManageReportSettings(role))
                  IconButton(
                    tooltip: 'Pengaturan laporan (kop, tim, logo, APD)',
                    icon: const Icon(Icons.settings),
                    onPressed: () => Navigator.push(context,
                        MaterialPageRoute(builder: (_) => HseSettingsScreen(siteId: _siteId ?? auth.user!.siteId))),
                  ),
              ]),
              const SizedBox(height: 8),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(children: [
                  for (final s in [null, 'DRAFT', 'REVISION', 'SUBMITTED', 'ACKNOWLEDGED', 'APPROVED'])
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(switch (s) {
                          null => 'Semua',
                          'DRAFT' => 'Draf',
                          'REVISION' => 'Revisi',
                          'SUBMITTED' => 'Menunggu PIC',
                          'ACKNOWLEDGED' => 'Menunggu HSE Mgr',
                          _ => 'Disetujui',
                        }),
                        selected: _status == s,
                        onSelected: (_) {
                          setState(() => _status = s);
                          _load();
                        },
                      ),
                    ),
                ]),
              ),
              const SizedBox(height: 8),
              if (_loading)
                const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()))
              else if (_items.isEmpty)
                const EmptyState(icon: Icons.description_outlined, text: 'Belum ada laporan.')
              else
                for (final r in _items)
                  Card(
                    child: ListTile(
                      leading: CircleAvatar(
                        backgroundColor: (hseStatusColors[r['status']] ?? Colors.grey).withValues(alpha: 0.15),
                        child: Icon(Icons.description, color: hseStatusColors[r['status']]),
                      ),
                      title: Text(fmtDate.format(DateTime.parse(r['reportDate'] as String))),
                      subtitle: Text('${r['reportNo']}\n${r['siteName']} · ${r['photoCount']} foto · ${r['createdByName']}'),
                      isThreeLine: true,
                      trailing: Text('${r['statusLabel']}',
                          textAlign: TextAlign.right,
                          style: TextStyle(color: hseStatusColors[r['status']], fontWeight: FontWeight.w600, fontSize: 12)),
                      onTap: () async {
                        await Navigator.push(
                            context, MaterialPageRoute(builder: (_) => HseReportEditor(id: r['id'] as int)));
                        _load();
                      },
                    ),
                  ),
            ]),
          ),
        ]),
      ),
    );
  }
}
