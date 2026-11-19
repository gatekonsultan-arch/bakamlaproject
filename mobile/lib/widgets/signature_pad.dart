import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../services/api.dart';
import 'common.dart';

/// Kotak tanda tangan: digambar dengan jari/stylus/mouse, diekspor sebagai PNG transparan.
class SignaturePadDialog extends StatefulWidget {
  const SignaturePadDialog({super.key});
  @override
  State<SignaturePadDialog> createState() => _SignaturePadDialogState();
}

class _SignaturePadDialogState extends State<SignaturePadDialog> {
  final List<List<Offset>> _strokes = [];
  Size _size = const Size(500, 200);

  Future<List<int>?> _export() async {
    if (_strokes.isEmpty) return null;
    final rec = ui.PictureRecorder();
    final canvas = Canvas(rec);
    const scale = 2.0;
    canvas.scale(scale);
    _SigPainter(_strokes).paint(canvas, _size);
    final img = await rec.endRecording().toImage((_size.width * scale).round(), (_size.height * scale).round());
    final data = await img.toByteData(format: ui.ImageByteFormat.png);
    return data?.buffer.asUint8List();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Tanda Tangan'),
      content: SizedBox(
        width: 500,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Text('Tanda tangani di kotak putih.', style: TextStyle(fontSize: 12)),
          const SizedBox(height: 8),
          AspectRatio(
            aspectRatio: 5 / 2,
            child: LayoutBuilder(builder: (context, c) {
              _size = Size(c.maxWidth, c.maxHeight);
              return Container(
                decoration: BoxDecoration(color: Colors.white, border: Border.all(color: Colors.grey)),
                child: GestureDetector(
                  onPanStart: (d) => setState(() => _strokes.add([d.localPosition])),
                  onPanUpdate: (d) => setState(() => _strokes.last.add(d.localPosition)),
                  child: CustomPaint(painter: _SigPainter(_strokes), size: Size.infinite),
                ),
              );
            }),
          ),
        ]),
      ),
      actions: [
        TextButton(onPressed: () => setState(_strokes.clear), child: const Text('Ulangi')),
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Batal')),
        FilledButton(
            onPressed: () async {
              final png = await _export();
              if (context.mounted) Navigator.of(context).pop(png);
            },
            child: const Text('Simpan')),
      ],
    );
  }
}

class _SigPainter extends CustomPainter {
  final List<List<Offset>> strokes;
  _SigPainter(this.strokes);

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = const Color(0xFF0D2A6B)
      ..strokeWidth = 2.6
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke;
    for (final s in strokes) {
      if (s.length == 1) {
        canvas.drawCircle(s.first, 1.3, paint..style = PaintingStyle.fill);
        paint.style = PaintingStyle.stroke;
        continue;
      }
      final path = Path()..moveTo(s.first.dx, s.first.dy);
      for (final p in s.skip(1)) {
        path.lineTo(p.dx, p.dy);
      }
      canvas.drawPath(path, paint);
    }
  }

  @override
  bool shouldRepaint(_SigPainter old) => true;
}

/// Minta user membuat/mengunggah tanda tangan. Mengembalikan URL tanda tangan baru, atau null bila batal.
Future<String?> promptSignature(BuildContext context, {String? reason}) async {
  // Nilai hasil dialog: 'draw' atau Future pemilihan gambar yang DIBUKA di dalam ketukan tombol
  // (Safari/Chrome di iPhone hanya mengizinkan membuka galeri tepat saat tombol diketuk).
  final choice = await showDialog<Object>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Tanda tangan digital'),
      content: Text(reason ??
          'Tanda tangan dipakai pada lembar persetujuan laporan. Gambar langsung, atau unggah foto/scan '
              'tanda tangan dengan tinta gelap di kertas putih (latar putih otomatis dibuat transparan).'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Batal')),
        OutlinedButton.icon(
            onPressed: () => Navigator.pop(ctx, ImagePicker().pickImage(source: ImageSource.gallery)),
            icon: const Icon(Icons.upload_file),
            label: const Text('Unggah gambar')),
        FilledButton.icon(onPressed: () => Navigator.pop(ctx, 'draw'), icon: const Icon(Icons.draw), label: const Text('Gambar')),
      ],
    ),
  );
  if (choice == null || !context.mounted) return null;
  List<int>? bytes;
  String filename = 'ttd.png';
  if (choice == 'draw') {
    bytes = await showDialog<List<int>>(context: context, builder: (_) => const SignaturePadDialog());
  } else if (choice is Future<XFile?>) {
    final x = await choice;
    if (x != null) {
      bytes = await x.readAsBytes();
      filename = x.name;
    }
  }
  if (bytes == null || !context.mounted) return null;
  try {
    final r = await Api.instance.upload('/hse-reports/me/signature', [(field: 'file', filename: filename, bytes: bytes)]);
    if (context.mounted) showSnack(context, 'Tanda tangan disimpan');
    return r['url'] as String?;
  } catch (e) {
    if (context.mounted) showSnack(context, e.toString(), error: true);
    return null;
  }
}

/// Kartu tanda tangan di Profil.
class SignatureCard extends StatefulWidget {
  const SignatureCard({super.key});
  @override
  State<SignatureCard> createState() => _SignatureCardState();
}

class _SignatureCardState extends State<SignatureCard> {
  String? _url;
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    Api.instance.get('/hse-reports/me/signature').then((r) {
      if (mounted) setState(() { _url = r['url'] as String?; _loaded = true; });
    }).catchError((_) {});
  }

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const Text('Tanda tangan digital', style: TextStyle(fontWeight: FontWeight.w600)),
            const Text('Wajib untuk mengirim, mengetahui, atau menyetujui laporan K3.', style: TextStyle(fontSize: 12)),
            const SizedBox(height: 8),
            Container(
              height: 90,
              color: Colors.white,
              alignment: Alignment.center,
              child: !_loaded
                  ? const SizedBox()
                  : _url == null
                      ? const Text('Belum ada tanda tangan', style: TextStyle(color: Colors.red))
                      : Image.network(Api.instance.abs(_url), fit: BoxFit.contain),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () async {
                final url = await promptSignature(context);
                if (url != null) setState(() => _url = url);
              },
              icon: const Icon(Icons.draw),
              label: Text(_url == null ? 'Buat / unggah tanda tangan' : 'Ganti tanda tangan'),
            ),
          ]),
        ),
      );
}
