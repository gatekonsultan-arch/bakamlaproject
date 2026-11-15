import 'package:flutter/material.dart';

import '../models/models.dart';
import '../services/api.dart';
import '../widgets/common.dart';

/// Laporan absensi untuk Superadmin, Admin, Project/Site/HSE Manager.
/// Site Manager otomatis hanya melihat lokasinya (dibatasi di server).
class ReportScreen extends StatefulWidget {
  const ReportScreen({super.key});
  @override
  State<ReportScreen> createState() => _ReportScreenState();
}

class _ReportScreenState extends State<ReportScreen> {
  final _api = Api.instance;
  DateTimeRange _range = DateTimeRange(start: DateTime.now(), end: DateTime.now());
  List<Attendance> _items = [];
  Map<String, dynamic>? _summary;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final results = await Future.wait([
        _api.get('/attendance', query: {
          'from': fmtYmd.format(_range.start),
          'to': fmtYmd.format(_range.end),
        }),
        _api.get('/attendance/summary', query: {'date': fmtYmd.format(_range.end)}),
      ]);
      setState(() {
        _items = (results[0]['attendance'] as List)
            .map((e) => Attendance.fromJson(e as Map<String, dynamic>))
            .toList();
        _summary = results[1];
      });
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pickRange() async {
    final now = DateTime.now();
    final r = await showDateRangePicker(
      context: context,
      firstDate: DateTime(now.year - 2),
      lastDate: now,
      initialDateRange: _range,
      helpText: 'Pilih rentang tanggal (maks. 93 hari)',
    );
    if (r != null) {
      setState(() => _range = r);
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = _summary;
    final absent = (s?['absent'] as List?) ?? const [];
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(16), children: [
        Constrained(
          maxWidth: 960,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            OutlinedButton.icon(
              onPressed: _pickRange,
              icon: const Icon(Icons.date_range),
              label: Text(_range.start == _range.end
                  ? fmtDate.format(_range.start)
                  : '${fmtYmd.format(_range.start)}  s/d  ${fmtYmd.format(_range.end)}'),
            ),
            const SizedBox(height: 16),
            if (_loading)
              const Center(child: CircularProgressIndicator())
            else ...[
              if (s != null)
                Wrap(spacing: 12, runSpacing: 12, children: [
                  _Stat('Total pegawai aktif', '${s['totalUsers']}'),
                  _Stat('Hadir (${s['date']})', '${s['present']}'),
                  _Stat('Sudah pulang', '${s['checkedOut']}'),
                  _Stat('Belum absen', '${absent.length}'),
                ]),
              if (absent.isNotEmpty) ...[
                const SizedBox(height: 12),
                ExpansionTile(
                  title: Text('Belum absen pada ${s!['date']} (${absent.length})'),
                  children: [
                    for (final u in absent)
                      ListTile(
                        dense: true,
                        title: Text(u['fullName'] as String),
                        subtitle: Text('${u['roleName']} · ${u['siteName'] ?? '-'}'),
                      ),
                  ],
                ),
              ],
              const SizedBox(height: 16),
              Text('Detail absensi (${_items.length})',
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              if (_items.isEmpty)
                const EmptyState(icon: Icons.inbox_outlined, text: 'Tidak ada data absensi.')
              else
                Card(
                  clipBehavior: Clip.antiAlias,
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: DataTable(columns: const [
                      DataColumn(label: Text('Tanggal')),
                      DataColumn(label: Text('Nama')),
                      DataColumn(label: Text('Role')),
                      DataColumn(label: Text('Lokasi')),
                      DataColumn(label: Text('Masuk')),
                      DataColumn(label: Text('Pulang')),
                      DataColumn(label: Text('Jarak (m)')),
                    ], rows: [
                      for (final a in _items)
                        DataRow(cells: [
                          DataCell(Text(a.date)),
                          DataCell(Text(a.fullName)),
                          DataCell(Text(a.roleName)),
                          DataCell(Text(a.siteName)),
                          DataCell(Text(fmtTime.format(a.checkIn.at))),
                          DataCell(Text(a.checkOut == null ? '-' : fmtTime.format(a.checkOut!.at))),
                          DataCell(Text('${a.checkIn.distanceM?.round() ?? '-'}'
                              ' / ${a.checkOut?.distanceM?.round() ?? '-'}')),
                        ]),
                    ]),
                  ),
                ),
            ],
          ]),
        ),
      ]),
    );
  }
}

class _Stat extends StatelessWidget {
  final String label;
  final String value;
  const _Stat(this.label, this.value);

  @override
  Widget build(BuildContext context) => SizedBox(
        width: 170,
        child: Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(value, style: Theme.of(context).textTheme.headlineMedium),
              Text(label, style: Theme.of(context).textTheme.bodySmall),
            ]),
          ),
        ),
      );
}
