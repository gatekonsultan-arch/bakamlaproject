import 'dart:ui' as ui;

import 'package:flutter/material.dart';

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
