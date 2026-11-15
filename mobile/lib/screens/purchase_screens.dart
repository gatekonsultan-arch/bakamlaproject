import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config.dart';
import '../main.dart';
import '../services/api.dart';
import '../widgets/common.dart';
import '../widgets/level.dart';
import '../widgets/signature_pad.dart';
import '../widgets/site_picker.dart';
import 'materials_screen.dart' show fmtQty;

final _rp = NumberFormat.currency(locale: 'id_ID', symbol: 'Rp ', decimalDigits: 0);

const statusColors = {
  'PENDING': Color(0xFFF9A825),
  'APPROVED': Color(0xFF1565C0),
  'REJECTED': Color(0xFFD32F2F),
  'ORDERED': Color(0xFF6A1B9A),
  'PARTIAL': Color(0xFFEF6C00),
  'RECEIVED': Color(0xFF2E7D32),
  'CANCELLED': Color(0xFF757575),
};

class StatusChip extends StatelessWidget {
  final String status;
  final String label;
  const StatusChip(this.status, this.label, {super.key});
  @override
  Widget build(BuildContext context) {
    final c = statusColors[status] ?? Colors.grey;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(6)),
      child: Text(label, style: TextStyle(color: c, fontWeight: FontWeight.w600, fontSize: 12)),
    );
  }
}

class PurchaseListTab extends StatefulWidget {
  const PurchaseListTab({super.key});
  @override
  State<PurchaseListTab> createState() => _PurchaseListTabState();
}

class _PurchaseListTabState extends State<PurchaseListTab> {
  List<Map<String, dynamic>> _items = [];
  String? _status;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final r = await Api.instance.get('/purchase-requests', query: {if (_status != null) 'status': _status!});
      setState(() => _items = (r['requests'] as List).cast<Map<String, dynamic>>());
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final role = auth.user!.role;
    return Scaffold(
      floatingActionButton: canRequestPurchase(role)
          ? FloatingActionButton.extended(
              onPressed: () async {
                final ok = await Navigator.push<bool>(
                    context, MaterialPageRoute(builder: (_) => const CreatePurchaseScreen()));
                if (ok == true) _load();
              },
              icon: const Icon(Icons.add_shopping_cart),
              label: const Text('Ajukan Pembelian'),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.fromLTRB(12, 12, 12, 88), children: [
          Constrained(
            maxWidth: 960,
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(children: [
                  for (final s in [null, 'PENDING', 'APPROVED', 'ORDERED', 'PARTIAL', 'RECEIVED', 'REJECTED'])
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(switch (s) {
                          null => 'Semua',
                          'PENDING' => 'Menunggu',
                          'APPROVED' => 'Disetujui',
                          'ORDERED' => 'Dipesan',
                          'PARTIAL' => 'Diterima sebagian',
                          'RECEIVED' => 'Selesai',
                          _ => 'Ditolak',
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
                const EmptyState(icon: Icons.receipt_long_outlined, text: 'Belum ada permintaan pembelian.')
              else
                for (final r in _items)
                  Card(
                    child: ListTile(
                      title: Text('${r['requestNo']}'),
                      subtitle: Text('${r['siteName']} · ${r['itemCount']} item · oleh ${r['requestedByName']}'
                          '${r['totalValue'] != null ? '\n${_rp.format(r['totalValue'])}' : ''}'),
                      isThreeLine: r['totalValue'] != null,
                      trailing: StatusChip(r['status'] as String, r['statusLabel'] as String),
                      onTap: () async {
                        await Navigator.push(context,
                            MaterialPageRoute(builder: (_) => PurchaseDetailScreen(id: r['id'] as int)));
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

// ---------------------------------------------------------------- Buat permintaan
class CreatePurchaseScreen extends StatefulWidget {
  const CreatePurchaseScreen({super.key});
  @override
  State<CreatePurchaseScreen> createState() => _CreatePurchaseScreenState();
}

class _CreatePurchaseScreenState extends State<CreatePurchaseScreen> {
  int? _siteId = auth.user!.siteId;
  List<Map<String, dynamic>> _plans = [];
  final Map<int, TextEditingController> _qty = {};
  final Map<int, TextEditingController> _price = {};
  final Map<int, TextEditingController> _brand = {};
  final Map<int, TextEditingController> _spec = {};
  final _note = TextEditingController();
  final _category = TextEditingController();
  bool _busy = false;

  Future<void> _loadPlans() async {
    if (_siteId == null) return;
    final r = await Api.instance.get('/materials/plans', query: {'siteId': '$_siteId'});
    setState(() {
      _plans = (r['plans'] as List).cast<Map<String, dynamic>>();
      _qty.clear();
      _price.clear();
    });
  }

  @override
  void initState() {
    super.initState();
    _loadPlans();
  }

  Future<void> _submit() async {
    final items = <Map<String, dynamic>>[];
    for (final p in _plans) {
      final q = double.tryParse((_qty[p['id']]?.text ?? '').replaceAll(',', '.'));
      if (q != null && q > 0) {
        final price = double.tryParse((_price[p['id']]?.text ?? '').replaceAll('.', '').replaceAll(',', '.'));
        items.add({
          'siteMaterialId': p['id'],
          'qty': q,
          if (price != null) 'unitPrice': price,
          'brand': _brand[p['id']]?.text ?? '',
          'spec': _spec[p['id']]?.text ?? '',
        });
      }
    }
    if (items.isEmpty) return showSnack(context, 'Isi jumlah minimal satu material', error: true);
    setState(() => _busy = true);
    try {
      final r = await Api.instance.post('/purchase-requests',
          {'siteId': _siteId, 'note': _note.text, 'category': _category.text, 'items': items});
      if (!mounted) return;
      final warn = (r['items'] as List).where((i) => i['projection']?['level'] == 'RED').toList();
      Navigator.pop(context, true);
      showSnack(
          context,
          warn.isEmpty
              ? 'Permintaan ${(r['request'] as Map)['requestNo']} dikirim ke Project Manager'
              : 'Terkirim, tetapi ${warn.length} material akan MELEBIHI kebutuhan jika disetujui',
          error: warn.isNotEmpty);
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Ajukan Pembelian')),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: FilledButton.icon(
              onPressed: _busy ? null : _submit, icon: const Icon(Icons.send), label: const Text('Kirim ke Project Manager')),
        ),
      ),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Constrained(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            SitePicker(value: _siteId, allowAll: false, onChanged: (v) {
              setState(() => _siteId = v);
              _loadPlans();
            }),
            const SizedBox(height: 8),
            TextField(controller: _note, decoration: const InputDecoration(labelText: 'Keperluan / catatan')),
            TextField(
                controller: _category,
                decoration: const InputDecoration(labelText: 'Paket / kategori material (mis. Struktur, Finishing)')),
            const SizedBox(height: 4),
            const Text('Isi merek & spesifikasi agar PM bisa menyetujui per item. Foto label material dapat ditambahkan '
                'setelah permintaan dibuat (buka detail permintaan).', style: TextStyle(fontSize: 12)),
            const SizedBox(height: 16),
            Text('Isi jumlah pada material yang akan dibeli:', style: Theme.of(context).textTheme.titleSmall),
            if (_plans.isEmpty)
              const EmptyState(
                  icon: Icons.inventory_2_outlined,
                  text: 'Belum ada kebutuhan material di lokasi ini. Minta PM/Site Manager menginputnya dulu.'),
            for (final p in _plans)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Expanded(child: Text('${p['name']}', style: const TextStyle(fontWeight: FontWeight.w600))),
                      LevelBadge(p['level'] as String, compact: true),
                    ]),
                    Text('Stok ${fmtQty(p['stock'])} · sisa boleh diadakan ${fmtQty(p['remainingToProcure'])} ${p['unit']}',
                        style: Theme.of(context).textTheme.bodySmall),
                    Row(children: [
                      Expanded(
                        child: TextField(
                          controller: _qty.putIfAbsent(p['id'] as int, TextEditingController.new),
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                          decoration: InputDecoration(labelText: 'Jumlah (${p['unit']})'),
                          onChanged: (_) => setState(() {}),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: _price.putIfAbsent(p['id'] as int, TextEditingController.new),
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(labelText: 'Harga satuan (opsional)'),
                        ),
                      ),
                    ]),
                    if ((double.tryParse((_qty[p['id']]?.text ?? '').replaceAll(',', '.')) ?? 0) > 0)
                      Row(children: [
                        Expanded(
                          child: TextField(
                            controller: _brand.putIfAbsent(p['id'] as int, TextEditingController.new),
                            decoration: const InputDecoration(labelText: 'Merek'),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          flex: 2,
                          child: TextField(
                            controller: _spec.putIfAbsent(p['id'] as int, TextEditingController.new),
                            decoration: const InputDecoration(labelText: 'Tipe / spesifikasi'),
                          ),
                        ),
                      ]),
                    Builder(builder: (_) {
                      final q = double.tryParse((_qty[p['id']]?.text ?? '').replaceAll(',', '.')) ?? 0;
                      if (q <= 0) return const SizedBox.shrink();
                      final rem = (p['remainingToProcure'] as num).toDouble();
                      if (q <= rem) return const SizedBox.shrink();
                      return Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text('⚠ Melebihi sisa kebutuhan sebesar ${fmtQty(q - rem)} ${p['unit']}',
                            style: TextStyle(color: levelColor('RED'))),
                      );
                    }),
                  ]),
                ),
              ),
          ]),
        ),
      ]),
    );
  }
}

// ---------------------------------------------------------------- Detail + aksi
class PurchaseDetailScreen extends StatefulWidget {
  final int id;
  const PurchaseDetailScreen({super.key, required this.id});
  @override
  State<PurchaseDetailScreen> createState() => _PurchaseDetailScreenState();
}

class _PurchaseDetailScreenState extends State<PurchaseDetailScreen> {
  Map<String, dynamic>? _data;
  bool _busy = false;
  // Keputusan PM per item: itemId -> 'APPROVE' | 'REJECT'
  final Map<int, String> _decision = {};
  final Map<int, TextEditingController> _reason = {};

  Future<void> _decide() async {
    final items = (_data!['items'] as List).cast<Map<String, dynamic>>();
    final missing = items.where((i) => _decision[i['id']] == null).length;
    if (missing > 0) return showSnack(context, 'Pilih Setujui/Tolak untuk $missing item lagi', error: true);
    final noReason = items.where((i) => _decision[i['id']] == 'REJECT' && (_reason[i['id']]?.text.trim() ?? '').isEmpty);
    if (noReason.isNotEmpty) return showSnack(context, 'Isi alasan penolakan: ${noReason.first['name']}', error: true);
    await _act('decide', {
      'items': [
        for (final i in items)
          {'itemId': i['id'], 'decision': _decision[i['id']], 'note': _reason[i['id']]?.text.trim() ?? ''},
      ],
    });
  }

  Future<void> _photo(Map<String, dynamic> item) async {
    XFile? x;
    try {
      x = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 2000);
    } catch (_) {
      x = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 2000);
    }
    if (x == null) return;
    try {
      await Api.instance.upload('/purchase-requests/${widget.id}/items/${item['id']}/photo',
          [(field: 'photo', filename: x.name, bytes: await x.readAsBytes())]);
      await _load();
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    }
  }

  Future<void> _print() async {
    try {
      final r = await Api.instance.post('/purchase-requests/${widget.id}/print-link', {});
      await launchUrl(Uri.parse(Api.instance.abs(r['url'] as String)), webOnlyWindowName: '_blank');
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    }
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await Api.instance.get('/purchase-requests/${widget.id}');
      setState(() => _data = r);
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    }
  }

  Future<void> _act(String action, [Map<String, dynamic>? body]) async {
    setState(() => _busy = true);
    try {
      final r = await Api.instance.post('/purchase-requests/${widget.id}/$action', body ?? {});
      if (mounted) showSnack(context, r['message'] as String? ?? 'Berhasil');
      await _load();
    } on ApiException catch (e) {
      if (e.data['code'] == 'SIGNATURE_REQUIRED' && mounted) {
        final url = await promptSignature(context, reason: e.message);
        if (url != null) {
          if (mounted) setState(() => _busy = false);
          return _act(action, body);
        }
      } else if (mounted) {
        showSnack(context, e.message, error: true);
      }
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<String?> _askText(String title, String label, {bool required = false}) async {
    final c = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: TextField(controller: c, decoration: InputDecoration(labelText: label), maxLines: 3),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Batal')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('OK')),
        ],
      ),
    );
    if (ok != true) return null;
    if (required && c.text.trim().isEmpty) {
      if (mounted) showSnack(context, '$label wajib diisi', error: true);
      return null;
    }
    return c.text.trim();
  }

  Future<void> _order() async {
    final supplier = TextEditingController();
    final po = TextEditingController();
    final eta = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Catat Pemesanan'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: supplier, decoration: const InputDecoration(labelText: 'Supplier')),
          TextField(controller: po, decoration: const InputDecoration(labelText: 'No. PO (opsional)')),
          TextField(controller: eta, decoration: const InputDecoration(labelText: 'Perkiraan tiba (YYYY-MM-DD, opsional)')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Batal')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Simpan')),
        ],
      ),
    );
    if (ok == true) {
      await _act('order', {
        'supplier': supplier.text,
        'poNumber': po.text,
        if (eta.text.trim().isNotEmpty) 'expectedDate': eta.text.trim(),
      });
    }
  }

  Future<void> _receive(List<Map<String, dynamic>> items) async {
    final ctrls = {for (final i in items) i['id'] as int: TextEditingController(text: fmtQty(i['remaining']).replaceAll('.', ''))};
    final ref = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Catat Penerimaan Barang'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            for (final i in items.where((i) => (i['remaining'] as num) > 0))
              TextField(
                controller: ctrls[i['id']],
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(labelText: '${i['name']} (sisa ${fmtQty(i['remaining'])} ${i['unit']})'),
              ),
            TextField(controller: ref, decoration: const InputDecoration(labelText: 'No. surat jalan (opsional)')),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Batal')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Simpan')),
        ],
      ),
    );
    if (ok != true) return;
    final rows = <Map<String, dynamic>>[];
    ctrls.forEach((id, c) {
      final q = double.tryParse(c.text.replaceAll(',', '.'));
      if (q != null && q > 0) rows.add({'itemId': id, 'qty': q});
    });
    if (rows.isEmpty) return;
    await _act('receive', {'items': rows, 'reference': ref.text});
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    if (d == null) return Scaffold(appBar: AppBar(), body: const Center(child: CircularProgressIndicator()));
    final r = d['request'] as Map<String, dynamic>;
    final items = (d['items'] as List).cast<Map<String, dynamic>>();
    final a = d['actions'] as Map<String, dynamic>;
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: Text('${r['requestNo']}'), actions: [
        IconButton(tooltip: 'Cetak formulir Material Submission', onPressed: _print, icon: const Icon(Icons.print)),
      ]),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Constrained(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              StatusChip(r['status'] as String, r['statusLabel'] as String),
              const Spacer(),
              Text('${r['siteName']}'),
            ]),
            const SizedBox(height: 8),
            Text('Diajukan oleh ${r['requestedByName']}'),
            if (r['note'] != null) Text('Keperluan: ${r['note']}'),
            if (r['category'] != null) Text('Paket/kategori: ${r['category']}'),
            if (r['decidedByName'] != null)
              Text('${r['status'] == 'REJECTED' ? 'Ditolak' : 'Disetujui'} oleh ${r['decidedByName']}'
                  '${r['decisionNote'] != null ? ': ${r['decisionNote']}' : ''}'),
            if (r['supplier'] != null) Text('Supplier: ${r['supplier']}${r['poNumber'] != null ? ' · PO ${r['poNumber']}' : ''}'),
            const SizedBox(height: 12),
            for (final i in items)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Expanded(child: Text('${i['name']}', style: const TextStyle(fontWeight: FontWeight.w600))),
                      Text('${fmtQty(i['qty'])} ${i['unit']}'),
                    ]),
                    if (i['unitPrice'] != null)
                      Text('${_rp.format(i['unitPrice'])} / ${i['unit']} = ${_rp.format((i['unitPrice'] as num) * (i['qty'] as num))}'),
                    if ((i['qtyReceived'] as num) > 0) Text('Diterima: ${fmtQty(i['qtyReceived'])} ${i['unit']}'),
                    if (i['brand'] != null || i['spec'] != null)
                      Text('Merek: ${i['brand'] ?? '-'} · Spesifikasi: ${i['spec'] ?? '-'}'),
                    const SizedBox(height: 6),
                    Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      if (i['photoUrl'] != null)
                        ClipRRect(
                          borderRadius: BorderRadius.circular(6),
                          child: Image.network(Api.instance.abs(i['photoUrl'] as String), width: 96, height: 72, fit: BoxFit.cover),
                        ),
                      if (a['uploadPhoto'] == true)
                        TextButton.icon(
                          onPressed: () => _photo(i),
                          icon: const Icon(Icons.add_a_photo, size: 18),
                          label: Text(i['photoUrl'] == null ? 'Foto label material' : 'Ganti foto'),
                        ),
                      const Spacer(),
                      if (i['itemStatus'] != 'PENDING')
                        Chip(
                          label: Text('${i['itemStatusLabel']}'),
                          backgroundColor: (i['itemStatus'] == 'APPROVED' ? Colors.green : Colors.red).withValues(alpha: 0.12),
                        ),
                    ]),
                    if (i['decisionNote'] != null)
                      Text('Alasan: ${i['decisionNote']}', style: const TextStyle(color: Color(0xFFD32F2F))),
                    if (a['decide'] == true) ...[
                      const SizedBox(height: 6),
                      SegmentedButton<String>(
                        emptySelectionAllowed: true,
                        segments: const [
                          ButtonSegment(value: 'APPROVE', label: Text('Setujui'), icon: Icon(Icons.check)),
                          ButtonSegment(value: 'REJECT', label: Text('Tolak'), icon: Icon(Icons.close)),
                        ],
                        selected: {if (_decision[i['id']] != null) _decision[i['id']]!},
                        onSelectionChanged: (v) => setState(() {
                          if (v.isEmpty) {
                            _decision.remove(i['id'] as int);
                          } else {
                            _decision[i['id'] as int] = v.first;
                          }
                        }),
                      ),
                      if (_decision[i['id']] == 'REJECT')
                        TextField(
                          controller: _reason.putIfAbsent(i['id'] as int, TextEditingController.new),
                          decoration: const InputDecoration(labelText: 'Alasan penolakan / revisi (wajib)'),
                        ),
                    ],
                    const SizedBox(height: 6),
                    Text('Kebutuhan ${fmtQty((i['material'] as Map)['plannedQty'])} · sudah diadakan '
                        '${fmtQty((i['material'] as Map)['procured'])} · stok ${fmtQty((i['material'] as Map)['stock'])}',
                        style: Theme.of(context).textTheme.bodySmall),
                    if (i['projection'] != null && (i['projection'] as Map)['message'] != null)
                      Container(
                        margin: const EdgeInsets.only(top: 8),
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: levelColor((i['projection'] as Map)['level'] as String).withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Row(children: [
                          Icon(levelIcon((i['projection'] as Map)['level'] as String),
                              color: levelColor((i['projection'] as Map)['level'] as String), size: 18),
                          const SizedBox(width: 8),
                          Expanded(child: Text('${(i['projection'] as Map)['message']}')),
                        ]),
                      ),
                  ]),
                ),
              ),
            const SizedBox(height: 12),
            if (a['decide'] == true) ...[
              FilledButton.icon(
                  onPressed: _busy ? null : _decide, icon: const Icon(Icons.fact_check), label: const Text('Simpan Keputusan per Item')),
              TextButton.icon(
                  onPressed: _busy ? null : () => _act('approve'),
                  icon: const Icon(Icons.done_all),
                  label: const Text('Setujui semua item')),
            ],
            if (a['reject'] == true)
              TextButton.icon(
                style: TextButton.styleFrom(foregroundColor: cs.error),
                onPressed: _busy
                    ? null
                    : () async {
                        final note = await _askText('Tolak Permintaan', 'Alasan penolakan', required: true);
                        if (note != null) await _act('reject', {'note': note});
                      },
                icon: const Icon(Icons.close),
                label: const Text('Tolak semua item'),
              ),
            if (a['order'] == true)
              FilledButton.icon(onPressed: _busy ? null : _order, icon: const Icon(Icons.local_shipping), label: const Text('Catat Pemesanan')),
            if (a['receive'] == true)
              FilledButton.icon(
                  onPressed: _busy ? null : () => _receive(items),
                  icon: const Icon(Icons.inventory),
                  label: const Text('Catat Barang Diterima')),
            if (a['cancel'] == true)
              TextButton(onPressed: _busy ? null : () => _act('cancel'), child: const Text('Batalkan permintaan')),
            if (r['status'] == 'PENDING' && auth.user!.role == 'PROJECT_MANAGER' && a['approve'] != true)
              const Text('Anda tidak dapat menyetujui permintaan yang Anda buat sendiri.'),
          ]),
        ),
      ]),
    );
  }
}
