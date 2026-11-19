import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';

import '../config.dart';
import '../main.dart';
import '../services/api.dart';
import '../services/location.dart';
import '../widgets/common.dart';
import '../widgets/signature_pad.dart';
import '../widgets/site_picker.dart';

final _rp = NumberFormat.decimalPattern('id_ID');
String rp(dynamic n) => 'Rp ${_rp.format((n as num?) ?? 0)}';
const catLabel = {'MANDOR': 'Mandor', 'TUKANG': 'Tukang', 'BURUH': 'Buruh'};
const statusShort = {'FULL': 'H', 'HALF': '½', 'ABSENT': 'A'};
const statusColor = {'FULL': Color(0xFF2E7D32), 'HALF': Color(0xFFF9A825), 'ABSENT': Color(0xFFD32F2F)};

DateTime _monday(DateTime d) => DateTime(d.year, d.month, d.day).subtract(Duration(days: d.weekday - 1));

/// Tenaga kerja harian: absen harian (Site Manager), rekap upah mingguan Senin–Sabtu, data pekerja.
class WorkersScreen extends StatefulWidget {
  const WorkersScreen({super.key});
  @override
  State<WorkersScreen> createState() => _WorkersScreenState();
}

class _WorkersScreenState extends State<WorkersScreen> {
  int? _siteId = auth.user!.siteId;

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      child: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
          child: Constrained(
            maxWidth: 1100,
            child: SitePicker(value: _siteId, allowAll: false, onChanged: (v) => setState(() => _siteId = v)),
          ),
        ),
        const TabBar(tabs: [
          Tab(icon: Icon(Icons.how_to_reg_outlined), text: 'Absen Harian'),
          Tab(icon: Icon(Icons.payments_outlined), text: 'Rekap Upah'),
          Tab(icon: Icon(Icons.badge_outlined), text: 'Data Pekerja'),
        ]),
        Expanded(
          child: _siteId == null
              ? const Center(child: Text('Pilih lokasi'))
              : TabBarView(children: [
                  _DailyTab(key: ValueKey('d$_siteId'), siteId: _siteId!),
                  _PayrollTab(key: ValueKey('p$_siteId'), siteId: _siteId!),
                  _WorkerListTab(key: ValueKey('w$_siteId'), siteId: _siteId!),
                ]),
        ),
      ]),
    );
  }
}

// ======================================================================= Absen harian
class _DailyTab extends StatefulWidget {
  final int siteId;
  const _DailyTab({super.key, required this.siteId});
  @override
  State<_DailyTab> createState() => _DailyTabState();
}

class _DailyTabState extends State<_DailyTab> {
  DateTime _date = DateTime.now().weekday == DateTime.sunday
      ? DateTime.now().subtract(const Duration(days: 1))
      : DateTime.now();
  Map<String, dynamic>? _data;
  final Map<int, String?> _status = {};
  final Map<int, double> _ot = {};
  bool _busy = false;
  bool _dirty = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await Api.instance.get('/workers/attendance', query: {'siteId': '${widget.siteId}', 'date': fmtYmd.format(_date)});
      setState(() {
        _data = r;
        _status.clear();
        _ot.clear();
        for (final e in (r['entries'] as List).cast<Map<String, dynamic>>()) {
          _status[e['workerId'] as int] = e['status'] as String?;
          _ot[e['workerId'] as int] = (e['overtimeHours'] as num).toDouble();
        }
        _dirty = false;
      });
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    }
  }

  bool get _editable =>
      _data != null && _data!['canEdit'] == true && _data!['locked'] != true && _data!['isSunday'] != true;

  Future<void> _save() async {
    final entries = [
      for (final e in _status.entries)
        if (e.value != null) {'workerId': e.key, 'status': e.value, 'overtimeHours': _ot[e.key] ?? 0},
    ];
    final missing = _status.values.where((v) => v == null).length;
    if (entries.isEmpty) return showSnack(context, 'Tandai kehadiran minimal satu pekerja', error: true);
    if (missing > 0) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Ada pekerja belum ditandai'),
          content: Text('$missing pekerja belum ditandai dan tidak akan disimpan. Lanjutkan?'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Kembali')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Simpan')),
          ],
        ),
      );
      if (ok != true) return;
    }
    setState(() => _busy = true);
    try {
      final pos = await LocationService.current();
      final r = await Api.instance.put('/workers/attendance', {
        'siteId': widget.siteId,
        'date': fmtYmd.format(_date),
        ...LocationService.toPayload(pos)..remove('deviceInfo'),
        'entries': entries,
      });
      if (mounted) showSnack(context, r['message'] as String);
      await _load();
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _photo() async {
    XFile? x;
    try {
      x = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 2000);
    } catch (_) {
      // Kamera tidak tersedia (mis. di komputer): pilih dari file.
      x = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 2000);
    }
    if (x == null) return;
    try {
      await Api.instance.upload('/workers/attendance/photo', [(field: 'photo', filename: x.name, bytes: await x.readAsBytes())],
          fields: {'siteId': '${widget.siteId}', 'date': fmtYmd.format(_date)});
      if (mounted) showSnack(context, 'Foto apel tersimpan');
      _load();
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    }
  }

  void _setAll(String s) => setState(() {
        for (final k in _status.keys) {
          _status[k] = s;
        }
        _dirty = true;
      });

  @override
  Widget build(BuildContext context) {
    final d = _data;
    if (d == null) return const Center(child: CircularProgressIndicator());
    final entries = (d['entries'] as List).cast<Map<String, dynamic>>();
    final count = {for (final s in ['FULL', 'HALF', 'ABSENT']) s: _status.values.where((v) => v == s).length};
    final sheet = d['sheet'] as Map<String, dynamic>?;
    return Scaffold(
      bottomNavigationBar: _editable
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: FilledButton.icon(
                  onPressed: _busy ? null : _save,
                  icon: const Icon(Icons.save),
                  label: Text(_dirty ? 'Simpan Absensi (lokasi GPS dicek)' : 'Simpan Absensi'),
                ),
              ),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(12), children: [
          Constrained(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(children: [
                IconButton(
                    onPressed: () {
                      _date = _date.subtract(Duration(days: _date.weekday == DateTime.monday ? 2 : 1));
                      _load();
                    },
                    icon: const Icon(Icons.chevron_left)),
                Expanded(
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.event),
                    label: Text(fmtDate.format(_date)),
                    onPressed: () async {
                      final p = await showDatePicker(
                          context: context,
                          firstDate: DateTime.now().subtract(const Duration(days: 365)),
                          lastDate: DateTime.now(),
                          initialDate: _date,
                          selectableDayPredicate: (x) => x.weekday != DateTime.sunday);
                      if (p != null) {
                        _date = p;
                        _load();
                      }
                    },
                  ),
                ),
                IconButton(
                    onPressed: fmtYmd.format(_date) == fmtYmd.format(DateTime.now())
                        ? null
                        : () {
                            final n = _date.add(Duration(days: _date.weekday == DateTime.saturday ? 2 : 1));
                            if (!n.isAfter(DateTime.now())) {
                              _date = n;
                              _load();
                            }
                          },
                    icon: const Icon(Icons.chevron_right)),
              ]),
              if (d['locked'] == true)
                const _Banner(Icons.lock, 'Rekap pekan ini sudah diajukan/disetujui. Absensi tidak dapat diubah.')
              else if (d['canEdit'] != true)
                const _Banner(Icons.visibility, 'Hanya Site Manager yang mengisi absensi tenaga kerja.'),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 8, children: [
                _Count('Hadir', count['FULL']!, statusColor['FULL']!),
                _Count('½ hari', count['HALF']!, statusColor['HALF']!),
                _Count('Tidak masuk', count['ABSENT']!, statusColor['ABSENT']!),
                _Count('Belum', _status.values.where((v) => v == null).length, Colors.grey),
              ]),
              if (sheet != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                      'Diisi ${sheet['recordedByName']} · ${(sheet['distanceM'] as num).round()} m dari titik lokasi'
                      '${sheet['photoUrl'] != null ? ' · foto apel ✓' : ''}',
                      style: Theme.of(context).textTheme.bodySmall),
                ),
              if (_editable)
                Wrap(spacing: 8, children: [
                  TextButton.icon(onPressed: () => _setAll('FULL'), icon: const Icon(Icons.done_all), label: const Text('Semua hadir')),
                  if (sheet != null)
                    TextButton.icon(onPressed: _photo, icon: const Icon(Icons.photo_camera), label: const Text('Foto apel pagi')),
                ]),
              if (entries.isEmpty)
                const EmptyState(icon: Icons.engineering, text: 'Belum ada pekerja. Tambahkan di tab Data Pekerja.'),
              for (final (i, e) in entries.indexed) ...[
                // Judul kelompok sekali per kategori (daftar sudah urut Mandor, Tukang, Buruh)
                if (i == 0 || entries[i - 1]['category'] != e['category'])
                  Padding(
                    padding: const EdgeInsets.fromLTRB(4, 12, 4, 4),
                    child: Text(catLabel[e['category']]!, style: Theme.of(context).textTheme.titleSmall),
                  ),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
                    child: Row(children: [
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('${e['name']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                          Text('${e['trade'] ?? catLabel[e['category']]} · ${rp(e['dailyRate'])}/hari',
                              style: Theme.of(context).textTheme.bodySmall),
                          if (_editable && _status[e['workerId']] != null && _status[e['workerId']] != 'ABSENT')
                            Row(children: [
                              const Text('Lembur: ', style: TextStyle(fontSize: 12)),
                              DropdownButton<double>(
                                isDense: true,
                                value: _ot[e['workerId']] ?? 0,
                                items: [for (var h = 0.0; h <= 6; h += 0.5) DropdownMenuItem(value: h, child: Text(h == 0 ? '-' : '$h jam'))],
                                onChanged: _editable ? (v) => setState(() { _ot[e['workerId'] as int] = v ?? 0; _dirty = true; }) : null,
                              ),
                            ]),
                        ]),
                      ),
                      if (_editable)
                        SegmentedButton<String>(
                          showSelectedIcon: false,
                          emptySelectionAllowed: true,
                          style: const ButtonStyle(visualDensity: VisualDensity.compact),
                          segments: const [
                            ButtonSegment(value: 'FULL', label: Text('Hadir')),
                            ButtonSegment(value: 'HALF', label: Text('½')),
                            ButtonSegment(value: 'ABSENT', label: Text('Tidak')),
                          ],
                          selected: {if (_status[e['workerId']] != null) _status[e['workerId']]!},
                          onSelectionChanged: _editable
                              ? (s) => setState(() {
                                    _status[e['workerId'] as int] = s.isEmpty ? null : s.first;
                                    _dirty = true;
                                  })
                              : null,
                        )
                      else
                        _StatusBadge(_status[e['workerId']], _ot[e['workerId']] ?? 0),
                    ]),
                  ),
                ),
              ],
              const SizedBox(height: 16),
            ]),
          ),
        ]),
      ),
    );
  }
}

/// Status kehadiran (tampilan baca saja, mis. saat pekan sudah terkunci).
class _StatusBadge extends StatelessWidget {
  final String? status;
  final double overtime;
  const _StatusBadge(this.status, this.overtime);
  @override
  Widget build(BuildContext context) {
    if (status == null) return const Text('Belum diabsen', style: TextStyle(color: Colors.grey));
    const label = {'FULL': 'Hadir', 'HALF': '½ hari', 'ABSENT': 'Tidak masuk'};
    final c = statusColor[status]!;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.12), border: Border.all(color: c), borderRadius: BorderRadius.circular(999)),
      child: Text('${label[status]}${overtime > 0 ? ' +${overtime}j lembur' : ''}',
          style: TextStyle(color: c, fontWeight: FontWeight.w600, fontSize: 12)),
    );
  }
}

class _Banner extends StatelessWidget {
  final IconData icon;
  final String text;
  const _Banner(this.icon, this.text);
  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(top: 8),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: Theme.of(context).colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(8)),
        child: Row(children: [Icon(icon, size: 18), const SizedBox(width: 8), Expanded(child: Text(text))]),
      );
}

class _Count extends StatelessWidget {
  final String label;
  final int n;
  final Color color;
  const _Count(this.label, this.n, this.color);
  @override
  Widget build(BuildContext context) => Chip(
        avatar: CircleAvatar(backgroundColor: color, child: Text('$n', style: const TextStyle(color: Colors.white, fontSize: 11))),
        label: Text(label),
      );
}

// ======================================================================= Rekap upah
class _PayrollTab extends StatefulWidget {
  final int siteId;
  const _PayrollTab({super.key, required this.siteId});
  @override
  State<_PayrollTab> createState() => _PayrollTabState();
}

class _PayrollTabState extends State<_PayrollTab> {
  DateTime _week = _monday(DateTime.now().weekday == DateTime.sunday ? DateTime.now().subtract(const Duration(days: 1)) : DateTime.now());
  Map<String, dynamic>? _data;
  List<Map<String, dynamic>> _advances = [];
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final ws = fmtYmd.format(_week);
      final r = await Future.wait([
        Api.instance.get('/workers/payroll', query: {'siteId': '${widget.siteId}', 'weekStart': ws}),
        Api.instance.get('/workers/advances', query: {'siteId': '${widget.siteId}', 'weekStart': ws}),
      ]);
      setState(() {
        _data = r[0];
        _advances = (r[1]['advances'] as List).cast<Map<String, dynamic>>();
      });
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    }
  }

  Future<void> _act(String action, {String? note}) async {
    setState(() => _busy = true);
    try {
      final r = await Api.instance.post('/workers/payroll/$action',
          {'siteId': widget.siteId, 'weekStart': fmtYmd.format(_week), if (note != null) 'note': note});
      if (mounted) showSnack(context, r['message'] as String);
      await _load();
    } on ApiException catch (e) {
      if (e.data['code'] == 'SIGNATURE_REQUIRED' && mounted) {
        final url = await promptSignature(context, reason: e.message);
        if (url != null) await _act(action, note: note);
      } else if (mounted) {
        showSnack(context, e.message, error: true);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _open(String format) async {
    try {
      final r = await Api.instance.post('/workers/payroll/link', {'siteId': widget.siteId, 'weekStart': fmtYmd.format(_week), 'format': format});
      await openPrintPage(Api.instance.abs(r['url'] as String));
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    }
  }

  Future<void> _addAdvance(List<Map<String, dynamic>> rows) async {
    int? workerId;
    final amount = TextEditingController();
    final note = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: const Text('Catat Kasbon'),
          content: SizedBox(
            width: 380,
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              DropdownButtonFormField<int>(
                value: workerId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Pekerja'),
                items: [for (final r in rows) DropdownMenuItem(value: r['workerId'] as int, child: Text('${r['name']} (${catLabel[r['category']]})'))],
                onChanged: (v) => set(() => workerId = v),
              ),
              TextField(controller: amount, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Jumlah (Rp)')),
              TextField(controller: note, decoration: const InputDecoration(labelText: 'Keterangan (opsional)')),
              const SizedBox(height: 8),
              const Text('Kasbon dipotong dari upah pekan tanggal kasbon dicatat (hari ini).', style: TextStyle(fontSize: 12)),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Batal')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Simpan')),
          ],
        ),
      ),
    );
    final value = double.tryParse(amount.text.replaceAll('.', '').replaceAll(',', '.'));
    if (ok != true || workerId == null || value == null || value <= 0) return;
    try {
      final r = await Api.instance.post('/workers/advances', {'workerId': workerId, 'amount': value, 'note': note.text});
      if (mounted) showSnack(context, r['message'] as String);
      _load();
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    if (d == null) return const Center(child: CircularProgressIndicator());
    final recap = d['recap'] as Map<String, dynamic>;
    final rows = (recap['rows'] as List).cast<Map<String, dynamic>>();
    final days = (recap['days'] as List).cast<String>();
    final t = recap['totals'] as Map<String, dynamic>;
    final a = d['actions'] as Map<String, dynamic>;
    final status = d['status'] as String;
    final stColor = {'APPROVED': const Color(0xFF2E7D32), 'PAID': const Color(0xFF1565C0), 'SUBMITTED': const Color(0xFFF9A825), 'RETURNED': const Color(0xFFD32F2F)}[status] ?? Colors.grey;
    final wide = MediaQuery.sizeOf(context).width >= 840;
    final dfmt = DateFormat('d MMM', 'id_ID');

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(12), children: [
        Constrained(
          maxWidth: 1100,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              IconButton(onPressed: () { _week = _week.subtract(const Duration(days: 7)); _load(); }, icon: const Icon(Icons.chevron_left)),
              Expanded(
                child: Text('Pekan ${dfmt.format(_week)} – ${dfmt.format(_week.add(const Duration(days: 5)))} ${_week.year}',
                    textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleMedium),
              ),
              IconButton(
                  onPressed: _week.add(const Duration(days: 7)).isAfter(DateTime.now())
                      ? null
                      : () { _week = _week.add(const Duration(days: 7)); _load(); },
                  icon: const Icon(Icons.chevron_right)),
            ]),
            Card(
              color: Color.alphaBlend(stColor.withValues(alpha: 0.08), Theme.of(context).colorScheme.surface),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Row(children: [
                    Icon(Icons.flag, color: stColor),
                    const SizedBox(width: 8),
                    Expanded(child: Text('${d['statusLabel']}', style: TextStyle(color: stColor, fontWeight: FontWeight.bold))),
                    IconButton(tooltip: 'Cetak / PDF', onPressed: () => _open('html'), icon: const Icon(Icons.print)),
                    IconButton(tooltip: 'Unduh Excel (CSV)', onPressed: () => _open('csv'), icon: const Icon(Icons.table_view)),
                  ]),
                  if (d['submittedByName'] != null) Text('Diajukan: ${d['submittedByName']}'),
                  if (d['approvedByName'] != null) Text('Disetujui: ${d['approvedByName']}'),
                  if (d['paidByName'] != null) Text('Dibayar dicatat oleh: ${d['paidByName']}'),
                  if (status == 'RETURNED' && d['returnNote'] != null)
                    Text('Catatan PM: ${d['returnNote']}', style: const TextStyle(color: Color(0xFFD32F2F))),
                  const SizedBox(height: 8),
                  Text('Total dibayar: ${rp(t['net'])}', style: Theme.of(context).textTheme.headlineSmall),
                  Text('${t['people']} orang · ${t['workDays']} hari kerja · upah ${rp(t['wage'])} + lembur ${rp(t['overtimePay'])} − kasbon ${rp(t['advance'])}'),
                  if ((t['unrecordedCells'] as num) > 0)
                    Text('⚠ ${t['unrecordedCells']} hari-orang belum diabsen pada pekan ini', style: const TextStyle(color: Color(0xFFEF6C00))),
                  if ((t['negativeNet'] as List).isNotEmpty)
                    Text('⚠ Kasbon melebihi upah: ${(t['negativeNet'] as List).join(', ')}', style: const TextStyle(color: Color(0xFFD32F2F))),
                  const SizedBox(height: 8),
                  Wrap(spacing: 8, runSpacing: 8, children: [
                    if (a['submit'] == true)
                      FilledButton.icon(onPressed: _busy ? null : () => _act('submit'), icon: const Icon(Icons.send), label: const Text('Ajukan ke PM')),
                    if (a['approve'] == true)
                      FilledButton.icon(onPressed: _busy ? null : () => _act('approve'), icon: const Icon(Icons.verified), label: const Text('Setujui')),
                    if (a['returnForRevision'] == true)
                      OutlinedButton.icon(
                        onPressed: _busy
                            ? null
                            : () async {
                                final c = TextEditingController();
                                final ok = await showDialog<bool>(
                                    context: context,
                                    builder: (ctx) => AlertDialog(
                                          title: const Text('Kembalikan ke Site Manager'),
                                          content: TextField(controller: c, maxLines: 3, decoration: const InputDecoration(labelText: 'Apa yang perlu diperbaiki?')),
                                          actions: [
                                            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Batal')),
                                            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Kembalikan')),
                                          ],
                                        ));
                                if (ok == true && c.text.trim().isNotEmpty) _act('return', note: c.text.trim());
                              },
                        icon: const Icon(Icons.undo),
                        label: const Text('Kembalikan'),
                      ),
                    if (a['markPaid'] == true)
                      FilledButton.tonalIcon(onPressed: _busy ? null : () => _act('paid'), icon: const Icon(Icons.paid), label: const Text('Tandai sudah dibayar')),
                    if (a['addAdvance'] == true && canRecordCashAdvance(auth.user!.role))
                      OutlinedButton.icon(onPressed: () => _addAdvance(rows), icon: const Icon(Icons.money_off), label: const Text('Catat Kasbon')),
                  ]),
                ]),
              ),
            ),
            const SizedBox(height: 8),
            if (rows.isEmpty) const EmptyState(icon: Icons.engineering, text: 'Belum ada pekerja di lokasi ini.'),
            if (rows.isNotEmpty && wide)
              Card(
                clipBehavior: Clip.antiAlias,
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: DataTable(
                    columnSpacing: 14,
                    headingRowHeight: 40,
                    columns: [
                      const DataColumn(label: Text('Nama')),
                      for (final day in days) DataColumn(label: Text(DateFormat('EEE d', 'id_ID').format(DateTime.parse(day)))),
                      const DataColumn(label: Text('Hari'), numeric: true),
                      const DataColumn(label: Text('Upah'), numeric: true),
                      const DataColumn(label: Text('Lembur'), numeric: true),
                      const DataColumn(label: Text('Kasbon'), numeric: true),
                      const DataColumn(label: Text('Diterima'), numeric: true),
                    ],
                    rows: [
                      for (final r in rows)
                        DataRow(cells: [
                          DataCell(Text('${r['name']}\n${catLabel[r['category']]}', style: const TextStyle(fontSize: 12))),
                          for (final day in days) DataCell(_DayCell((r['days'] as Map)[day] as Map?)),
                          DataCell(Text('${r['workDays']}')),
                          DataCell(Text(_rp.format(r['wage']))),
                          DataCell(Text(r['overtimePay'] == 0 ? '-' : '${_rp.format(r['overtimePay'])}\n(${r['overtimeHours']} j)')),
                          DataCell(Text(r['advance'] == 0 ? '-' : '(${_rp.format(r['advance'])})')),
                          DataCell(Text(_rp.format(r['net']),
                              style: TextStyle(fontWeight: FontWeight.bold, color: (r['net'] as num) < 0 ? Colors.red : null))),
                        ]),
                    ],
                  ),
                ),
              ),
            if (rows.isNotEmpty && !wide)
              for (final r in rows)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Expanded(child: Text('${r['name']}', style: const TextStyle(fontWeight: FontWeight.w600))),
                        Text(rp(r['net']), style: TextStyle(fontWeight: FontWeight.bold, color: (r['net'] as num) < 0 ? Colors.red : null)),
                      ]),
                      Text('${catLabel[r['category']]} · ${r['workDays']} hari × ${(r['ratesUsed'] as List).map((x) => _rp.format(x)).join(' / ')}',
                          style: Theme.of(context).textTheme.bodySmall),
                      const SizedBox(height: 6),
                      Row(children: [
                        for (final day in days)
                          Expanded(
                            child: Column(children: [
                              Text(DateFormat('EEE', 'id_ID').format(DateTime.parse(day)), style: const TextStyle(fontSize: 10)),
                              _DayCell((r['days'] as Map)[day] as Map?),
                            ]),
                          ),
                      ]),
                      const SizedBox(height: 6),
                      Text('Upah ${rp(r['wage'])}'
                          '${(r['overtimePay'] as num) > 0 ? ' + lembur ${rp(r['overtimePay'])} (${r['overtimeHours']} jam)' : ''}'
                          '${(r['advance'] as num) > 0 ? ' − kasbon ${rp(r['advance'])}' : ''}',
                          style: const TextStyle(fontSize: 12)),
                    ]),
                  ),
                ),
            if (_advances.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text('Kasbon pekan ini', style: Theme.of(context).textTheme.titleSmall),
              for (final adv in _advances)
                ListTile(
                  dense: true,
                  leading: const Icon(Icons.money_off),
                  title: Text('${adv['name']} · ${rp(adv['amount'])}'),
                  subtitle: Text('${adv['advDate']} · ${adv['note'] ?? ''} · dicatat ${adv['recordedByName']}'),
                  trailing: a['addAdvance'] == true && canRecordCashAdvance(auth.user!.role)
                      ? IconButton(
                          icon: const Icon(Icons.delete_outline),
                          onPressed: () async {
                            try {
                              await Api.instance.delete('/workers/advances/${adv['id']}');
                              _load();
                            } catch (e) {
                              if (context.mounted) showSnack(context, e.toString(), error: true);
                            }
                          })
                      : null,
                ),
            ],
            const SizedBox(height: 8),
            const Text('H = hadir penuh · ½ = setengah hari (50%) · A = tidak masuk · · = belum diabsen. Periode Senin–Sabtu.',
                style: TextStyle(fontSize: 12)),
          ]),
        ),
      ]),
    );
  }
}

class _DayCell extends StatelessWidget {
  final Map? day;
  const _DayCell(this.day);
  @override
  Widget build(BuildContext context) {
    if (day == null) return const Text('·', style: TextStyle(color: Colors.grey));
    final st = day!['status'] as String;
    final ot = (day!['overtimeHours'] as num?) ?? 0;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(color: statusColor[st]!.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(4)),
      child: Text('${statusShort[st]}${ot > 0 ? '+$ot' : ''}', style: TextStyle(color: statusColor[st], fontWeight: FontWeight.bold, fontSize: 12)),
    );
  }
}

// ======================================================================= Data pekerja
class _WorkerListTab extends StatefulWidget {
  final int siteId;
  const _WorkerListTab({super.key, required this.siteId});
  @override
  State<_WorkerListTab> createState() => _WorkerListTabState();
}

class _WorkerListTabState extends State<_WorkerListTab> {
  List<Map<String, dynamic>> _items = [];
  bool _showInactive = false;
  String? _cat;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await Api.instance.get('/workers', query: {'siteId': '${widget.siteId}', 'active': _showInactive ? 'all' : '1'});
      setState(() => _items = (r['workers'] as List).cast<Map<String, dynamic>>());
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    }
  }

  Future<void> _form([Map<String, dynamic>? w]) async {
    final ok = await showDialog<bool>(context: context, builder: (_) => _WorkerForm(siteId: widget.siteId, worker: w));
    if (ok == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    final shown = _cat == null ? _items : _items.where((w) => w['category'] == _cat).toList();
    return Scaffold(
      floatingActionButton: canManageWorkers(auth.user!.role)
          ? FloatingActionButton.extended(onPressed: () => _form(), icon: const Icon(Icons.person_add), label: const Text('Tambah Pekerja'))
          : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.fromLTRB(12, 12, 12, 88), children: [
          Constrained(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
                ChoiceChip(label: Text('Semua (${_items.length})'), selected: _cat == null, onSelected: (_) => setState(() => _cat = null)),
                for (final c in catLabel.keys)
                  ChoiceChip(
                      label: Text('${catLabel[c]} (${_items.where((w) => w['category'] == c).length})'),
                      selected: _cat == c,
                      onSelected: (_) => setState(() => _cat = _cat == c ? null : c)),
                FilterChip(
                    label: const Text('Tampilkan nonaktif'),
                    selected: _showInactive,
                    onSelected: (v) { _showInactive = v; _load(); }),
              ]),
              const SizedBox(height: 8),
              if (shown.isEmpty) const EmptyState(icon: Icons.engineering, text: 'Belum ada pekerja.'),
              for (final w in shown)
                Card(
                  child: ListTile(
                    leading: CircleAvatar(child: Text(catLabel[w['category']]!.substring(0, 1))),
                    title: Text('${w['name']}', style: TextStyle(decoration: w['isActive'] == true ? null : TextDecoration.lineThrough)),
                    subtitle: Text('${catLabel[w['category']]}${w['trade'] != null ? ' · ${w['trade']}' : ''}'
                        '\nUpah ${rp(w['dailyRate'])}/hari · lembur ${rp(w['overtimeRate'])}/jam${w['isActive'] == true ? '' : ' · NONAKTIF'}'),
                    isThreeLine: true,
                    onTap: canManageWorkers(auth.user!.role) ? () => _form(w) : null,
                  ),
                ),
            ]),
          ),
        ]),
      ),
    );
  }
}

class _WorkerForm extends StatefulWidget {
  final int siteId;
  final Map<String, dynamic>? worker;
  const _WorkerForm({required this.siteId, this.worker});
  @override
  State<_WorkerForm> createState() => _WorkerFormState();
}

class _WorkerFormState extends State<_WorkerForm> {
  late final _name = TextEditingController(text: widget.worker?['name'] as String?);
  late final _trade = TextEditingController(text: widget.worker?['trade'] as String?);
  late final _nik = TextEditingController(text: widget.worker?['nik'] as String?);
  late final _phone = TextEditingController(text: widget.worker?['phone'] as String?);
  late final _rate = TextEditingController(text: widget.worker == null ? '' : '${(widget.worker!['dailyRate'] as num).round()}');
  late final _ot = TextEditingController(text: widget.worker == null ? '0' : '${(widget.worker!['overtimeRate'] as num).round()}');
  late String _cat = (widget.worker?['category'] as String?) ?? 'TUKANG';
  late bool _active = (widget.worker?['isActive'] as bool?) ?? true;
  bool _busy = false;

  double? _num(String s) => double.tryParse(s.replaceAll('.', '').replaceAll(',', '.'));

  Future<void> _save() async {
    final rate = _num(_rate.text);
    if (_name.text.trim().isEmpty || rate == null) return showSnack(context, 'Nama dan upah harian wajib diisi', error: true);
    setState(() => _busy = true);
    final body = {
      'name': _name.text.trim(), 'category': _cat, 'trade': _trade.text, 'nik': _nik.text, 'phone': _phone.text,
      'dailyRate': rate, 'overtimeRate': _num(_ot.text) ?? 0, 'isActive': _active,
    };
    try {
      if (widget.worker == null) {
        await Api.instance.post('/workers', {...body, 'siteId': widget.siteId});
      } else {
        await Api.instance.put('/workers/${widget.worker!['id']}', body);
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(widget.worker == null ? 'Tambah Pekerja' : 'Ubah Pekerja'),
        content: SizedBox(
          width: 420,
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              TextField(controller: _name, decoration: const InputDecoration(labelText: 'Nama lengkap')),
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerLeft,
                child: Wrap(spacing: 8, children: [
                  for (final e in catLabel.entries)
                    ChoiceChip(label: Text(e.value), selected: _cat == e.key, onSelected: (_) => setState(() => _cat = e.key)),
                ]),
              ),
              TextField(controller: _trade, decoration: const InputDecoration(labelText: 'Keahlian (mis. Tukang Batu, Tukang Besi)')),
              TextField(controller: _rate, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Upah harian (Rp)')),
              TextField(controller: _ot, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Tarif lembur per jam (Rp)')),
              TextField(controller: _nik, decoration: const InputDecoration(labelText: 'NIK (opsional)')),
              TextField(controller: _phone, decoration: const InputDecoration(labelText: 'No. HP (opsional)')),
              if (widget.worker != null) ...[
                SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Aktif'), value: _active, onChanged: (v) => setState(() => _active = v)),
                const Text('Perubahan upah berlaku untuk hari yang dicatat setelah ini. Hari yang sudah dicatat tetap memakai upah lama.',
                    style: TextStyle(fontSize: 12)),
              ],
            ]),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Batal')),
          FilledButton(onPressed: _busy ? null : _save, child: const Text('Simpan')),
        ],
      );
}
