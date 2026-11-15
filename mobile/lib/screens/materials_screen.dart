import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../config.dart';
import '../main.dart';
import '../services/api.dart';
import '../widgets/common.dart';
import '../widgets/level.dart';
import '../widgets/site_picker.dart';
import 'purchase_screens.dart';

final _num = NumberFormat.decimalPattern('id_ID');
String fmtQty(dynamic n) => _num.format((n as num?) ?? 0);
double _d(dynamic n) => ((n as num?) ?? 0).toDouble();

/// Kontrol material: tab Kebutuhan & Stok, dan tab Permintaan Pembelian.
class MaterialsScreen extends StatelessWidget {
  const MaterialsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const DefaultTabController(
      length: 2,
      child: Column(children: [
        TabBar(tabs: [
          Tab(icon: Icon(Icons.inventory_2_outlined), text: 'Material & Stok'),
          Tab(icon: Icon(Icons.shopping_cart_outlined), text: 'Pembelian'),
        ]),
        Expanded(child: TabBarView(children: [_PlansTab(), PurchaseListTab()])),
      ]),
    );
  }
}

class _PlansTab extends StatefulWidget {
  const _PlansTab();
  @override
  State<_PlansTab> createState() => _PlansTabState();
}

class _PlansTabState extends State<_PlansTab> {
  int? _siteId;
  String? _level;
  List<Map<String, dynamic>> _plans = [];
  Map<String, dynamic> _counts = {};
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final r = await Api.instance.get('/materials/plans', query: {
        if (_siteId != null) 'siteId': '$_siteId',
      });
      setState(() {
        _plans = (r['plans'] as List).cast<Map<String, dynamic>>();
        _counts = r['counts'] as Map<String, dynamic>;
      });
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final role = auth.user!.role;
    final shown = _level == null ? _plans : _plans.where((p) => p['level'] == _level).toList();
    return Scaffold(
      floatingActionButton: canPlanMaterials(role)
          ? FloatingActionButton.extended(
              onPressed: () async {
                final ok = await showDialog<bool>(
                    context: context, builder: (_) => PlanFormDialog(siteId: _siteId ?? auth.user!.siteId));
                if (ok == true) _load();
              },
              icon: const Icon(Icons.add),
              label: const Text('Input Kebutuhan'),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.fromLTRB(12, 12, 12, 88), children: [
          Constrained(
            maxWidth: 960,
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              SitePicker(value: _siteId, onChanged: (v) {
                setState(() => _siteId = v);
                _load();
              }),
              const SizedBox(height: 12),
              Wrap(spacing: 8, runSpacing: 8, children: [
                ChoiceChip(
                    label: Text('Semua (${_plans.length})'),
                    selected: _level == null,
                    onSelected: (_) => setState(() => _level = null)),
                for (final l in ['RED', 'YELLOW', 'GREEN'])
                  ChoiceChip(
                    avatar: Icon(levelIcon(l), color: levelColor(l), size: 18),
                    label: Text('${levelLabel(l)} (${_counts[l] ?? 0})'),
                    selected: _level == l,
                    onSelected: (_) => setState(() => _level = _level == l ? null : l),
                  ),
              ]),
              const SizedBox(height: 8),
              if (_loading)
                const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()))
              else if (shown.isEmpty)
                const EmptyState(icon: Icons.inventory_2_outlined, text: 'Belum ada data kebutuhan material.')
              else
                for (final p in shown) _PlanCard(plan: p, onChanged: _load),
            ]),
          ),
        ]),
      ),
    );
  }
}

class _PlanCard extends StatelessWidget {
  final Map<String, dynamic> plan;
  final VoidCallback onChanged;
  const _PlanCard({required this.plan, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final p = plan;
    final level = p['level'] as String;
    final flags = (p['flags'] as List).cast<Map<String, dynamic>>();
    final unit = p['unit'];
    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: level == 'GREEN' ? BorderSide.none : BorderSide(color: levelColor(level), width: 1.5),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () async {
          await Navigator.push(context, MaterialPageRoute(builder: (_) => PlanDetailScreen(planId: p['id'] as int)));
          onChanged();
        },
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${p['name']}', style: Theme.of(context).textTheme.titleMedium),
                  Text('${p['code']} · ${p['siteName']}', style: Theme.of(context).textTheme.bodySmall),
                ]),
              ),
              LevelBadge(level),
            ]),
            const SizedBox(height: 10),
            Wrap(spacing: 16, runSpacing: 4, children: [
              Text('Kebutuhan: ${fmtQty(p['plannedQty'])} $unit'),
              Text('Stok: ${fmtQty(p['stock'])} $unit', style: const TextStyle(fontWeight: FontWeight.w600)),
              Text('Dipesan: ${fmtQty(p['onOrder'])}'),
              Text('Terpakai: ${fmtQty(p['used'])}'),
            ]),
            const SizedBox(height: 10),
            ThresholdBar(label: 'Pengadaan vs kebutuhan', pct: _d(p['procuredPct']), warnPct: p['warnPct'] as int),
            const SizedBox(height: 6),
            ThresholdBar(label: 'Pemakaian vs kebutuhan', pct: _d(p['usedPct']), warnPct: p['warnPct'] as int),
            for (final f in flags)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Icon(levelIcon(f['level'] as String), size: 16, color: levelColor(f['level'] as String)),
                  const SizedBox(width: 6),
                  Expanded(child: Text('${f['message']}', style: TextStyle(color: levelColor(f['level'] as String)))),
                ]),
              ),
          ]),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------- Detail kebutuhan + riwayat stok
class PlanDetailScreen extends StatefulWidget {
  final int planId;
  const PlanDetailScreen({super.key, required this.planId});
  @override
  State<PlanDetailScreen> createState() => _PlanDetailScreenState();
}

class _PlanDetailScreenState extends State<PlanDetailScreen> {
  Map<String, dynamic>? _plan;
  List<Map<String, dynamic>> _moves = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await Api.instance.get('/materials/plans/${widget.planId}');
      setState(() {
        _plan = r['plan'] as Map<String, dynamic>;
        _moves = (r['movements'] as List).cast<Map<String, dynamic>>();
      });
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    }
  }

  Future<void> _movement(String type) async {
    final ok = await showDialog<bool>(
        context: context, builder: (_) => _MovementDialog(plan: _plan!, type: type));
    if (ok == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    final p = _plan;
    final role = auth.user!.role;
    return Scaffold(
      appBar: AppBar(title: Text(p == null ? 'Material' : '${p['name']}'), actions: [
        if (p != null && canPlanMaterials(role))
          IconButton(
            tooltip: 'Ubah kebutuhan / ambang batas',
            icon: const Icon(Icons.edit),
            onPressed: () async {
              final ok = await showDialog<bool>(context: context, builder: (_) => PlanFormDialog(existing: p));
              if (ok == true) _load();
            },
          ),
      ]),
      body: p == null
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(padding: const EdgeInsets.all(16), children: [
                Constrained(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    _PlanCard(plan: p, onChanged: _load),
                    const SizedBox(height: 8),
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('Ambang batas', style: Theme.of(context).textTheme.titleSmall),
                          const SizedBox(height: 6),
                          Text('• Kebutuhan (rencana): ${fmtQty(p['plannedQty'])} ${p['unit']}'),
                          Text('• Stok minimum: ${fmtQty(p['minStock'])} ${p['unit']}'),
                          Text('• Tanda kuning mulai: ${p['warnPct']}% dari kebutuhan / stok ≤ '
                              '${fmtQty(_d(p['minStock']) / ((p['warnPct'] as int) / 100))}'),
                          Text('• Sisa yang boleh diadakan: ${fmtQty(p['remainingToProcure'])} ${p['unit']}'),
                          if ((p['pending'] as num) > 0)
                            Text('• Menunggu persetujuan: ${fmtQty(p['pending'])} ${p['unit']}'),
                          if (p['notes'] != null) Text('• Catatan: ${p['notes']}'),
                        ]),
                      ),
                    ),
                    if (canHandleStock(role)) ...[
                      const SizedBox(height: 8),
                      Row(children: [
                        Expanded(
                          child: FilledButton.icon(
                              onPressed: () => _movement('OUT'),
                              icon: const Icon(Icons.output),
                              label: const Text('Catat Pemakaian')),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: OutlinedButton.icon(
                              onPressed: () => _movement('ADJ'),
                              icon: const Icon(Icons.tune),
                              label: const Text('Stok Opname')),
                        ),
                      ]),
                    ],
                    const SizedBox(height: 16),
                    Text('Riwayat keluar-masuk', style: Theme.of(context).textTheme.titleMedium),
                    if (_moves.isEmpty) const EmptyState(icon: Icons.swap_vert, text: 'Belum ada pergerakan stok.'),
                    for (final m in _moves)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: Icon(switch (m['movementType']) {
                          'IN' => Icons.south_west,
                          'OUT' => Icons.north_east,
                          _ => Icons.tune,
                        }, color: m['movementType'] == 'IN' ? Colors.green : m['movementType'] == 'OUT' ? Colors.orange : null),
                        title: Text('${switch (m['movementType']) {
                          'IN' => 'Diterima',
                          'OUT' => 'Dipakai',
                          _ => 'Penyesuaian',
                        }} ${fmtQty(m['qty'])} ${p['unit']}'),
                        subtitle: Text([
                          m['movementDate'],
                          m['createdByName'],
                          if (m['requestNo'] != null) m['requestNo'],
                          if (m['reference'] != null) m['reference'],
                          if (m['note'] != null) m['note'],
                        ].join(' · ')),
                      ),
                  ]),
                ),
              ]),
            ),
    );
  }
}

class _MovementDialog extends StatefulWidget {
  final Map<String, dynamic> plan;
  final String type;
  const _MovementDialog({required this.plan, required this.type});
  @override
  State<_MovementDialog> createState() => _MovementDialogState();
}

class _MovementDialogState extends State<_MovementDialog> {
  final _qty = TextEditingController();
  final _note = TextEditingController();
  final _ref = TextEditingController();
  bool _busy = false;

  Future<void> _save() async {
    final qty = double.tryParse(_qty.text.replaceAll(',', '.'));
    if (qty == null || qty == 0) return showSnack(context, 'Jumlah tidak valid', error: true);
    setState(() => _busy = true);
    try {
      final r = await Api.instance.post('/materials/movements', {
        'siteMaterialId': widget.plan['id'],
        'type': widget.type,
        'qty': qty,
        'note': _note.text,
        'reference': _ref.text,
      });
      if (!mounted) return;
      Navigator.pop(context, true);
      final plan = r['plan'] as Map<String, dynamic>;
      final flags = (plan['flags'] as List).cast<Map<String, dynamic>>();
      showSnack(context,
          flags.isEmpty ? r['message'] as String : '${r['message']}. Perhatian: ${flags.map((f) => f['message']).join('; ')}',
          error: plan['level'] == 'RED');
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final out = widget.type == 'OUT';
    return AlertDialog(
      title: Text(out ? 'Catat Pemakaian' : 'Stok Opname / Penyesuaian'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        Text('Stok saat ini: ${fmtQty(widget.plan['stock'])} ${widget.plan['unit']}'),
        TextField(
          controller: _qty,
          keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
          decoration: InputDecoration(
              labelText: 'Jumlah (${widget.plan['unit']})',
              helperText: out ? null : 'Positif = tambah, negatif = kurangi'),
        ),
        TextField(controller: _ref, decoration: const InputDecoration(labelText: 'Referensi (opsional)')),
        TextField(
            controller: _note,
            decoration: InputDecoration(labelText: out ? 'Dipakai untuk (opsional)' : 'Alasan penyesuaian (wajib)')),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Batal')),
        FilledButton(onPressed: _busy ? null : _save, child: const Text('Simpan')),
      ],
    );
  }
}

// ---------------------------------------------------------------- Form kebutuhan material
class PlanFormDialog extends StatefulWidget {
  final int? siteId;
  final Map<String, dynamic>? existing;
  const PlanFormDialog({super.key, this.siteId, this.existing});
  @override
  State<PlanFormDialog> createState() => _PlanFormDialogState();
}

class _PlanFormDialogState extends State<PlanFormDialog> {
  late int? _siteId = widget.siteId;
  int? _materialId;
  List<Map<String, dynamic>> _catalog = [];
  late final _planned = TextEditingController(text: widget.existing == null ? '' : '${widget.existing!['plannedQty']}');
  late final _min = TextEditingController(text: widget.existing == null ? '0' : '${widget.existing!['minStock']}');
  late final _warn = TextEditingController(text: '${widget.existing?['warnPct'] ?? 80}');
  late final _notes = TextEditingController(text: widget.existing?['notes'] as String? ?? '');
  bool _busy = false;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    if (!_isEdit) _loadCatalog();
  }

  Future<void> _loadCatalog() async {
    final r = await Api.instance.get('/materials/catalog');
    setState(() => _catalog =
        (r['materials'] as List).cast<Map<String, dynamic>>().where((m) => m['isActive'] == true).toList());
  }

  Future<void> _newMaterial() async {
    final code = TextEditingController();
    final name = TextEditingController();
    final unit = TextEditingController();
    final cat = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Material Baru'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: code, decoration: const InputDecoration(labelText: 'Kode (mis. SEM-50)')),
          TextField(controller: name, decoration: const InputDecoration(labelText: 'Nama material')),
          TextField(controller: unit, decoration: const InputDecoration(labelText: 'Satuan (sak, m3, batang, kg)')),
          TextField(controller: cat, decoration: const InputDecoration(labelText: 'Kategori (opsional)')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Batal')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Simpan')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      final r = await Api.instance.post('/materials/catalog',
          {'code': code.text, 'name': name.text, 'unit': unit.text, 'category': cat.text});
      await _loadCatalog();
      setState(() => _materialId = (r['material'] as Map)['id'] as int);
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    }
  }

  Future<void> _save() async {
    final planned = double.tryParse(_planned.text.replaceAll(',', '.'));
    final min = double.tryParse(_min.text.replaceAll(',', '.')) ?? 0;
    final warn = int.tryParse(_warn.text) ?? 80;
    if (planned == null || planned <= 0) return showSnack(context, 'Jumlah kebutuhan harus > 0', error: true);
    if (!_isEdit && (_siteId == null || _materialId == null)) {
      return showSnack(context, 'Pilih lokasi dan material', error: true);
    }
    setState(() => _busy = true);
    try {
      final body = {'plannedQty': planned, 'minStock': min, 'warnPct': warn, 'notes': _notes.text};
      if (_isEdit) {
        await Api.instance.put('/materials/plans/${widget.existing!['id']}', body);
      } else {
        await Api.instance.post('/materials/plans', {...body, 'siteId': _siteId, 'materialId': _materialId});
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(_isEdit ? 'Ubah ${widget.existing!['name']}' : 'Input Kebutuhan Material'),
      content: SizedBox(
        width: 440,
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (!_isEdit) ...[
              SitePicker(value: _siteId, allowAll: false, onChanged: (v) => setState(() => _siteId = v)),
              const SizedBox(height: 12),
              Row(children: [
                Expanded(
                  child: DropdownButtonFormField<int>(
                    value: _materialId,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Material', border: OutlineInputBorder(), isDense: true),
                    items: [
                      for (final m in _catalog)
                        DropdownMenuItem(value: m['id'] as int, child: Text('${m['name']} (${m['unit']})')),
                    ],
                    onChanged: (v) => setState(() => _materialId = v),
                  ),
                ),
                IconButton(tooltip: 'Material baru', onPressed: _newMaterial, icon: const Icon(Icons.add_box_outlined)),
              ]),
            ],
            TextField(
                controller: _planned,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Jumlah kebutuhan (sesuai rencana/RAB)')),
            TextField(
                controller: _min,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Stok minimum di lokasi', helperText: '0 = tanpa peringatan stok')),
            TextField(
                controller: _warn,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                    labelText: 'Tanda kuning mulai (%)', helperText: 'Default 80%: kuning saat mencapai 80% dari batas')),
            TextField(controller: _notes, decoration: const InputDecoration(labelText: 'Catatan (opsional)')),
          ]),
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Batal')),
        FilledButton(onPressed: _busy ? null : _save, child: const Text('Simpan')),
      ],
    );
  }
}
