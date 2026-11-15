import 'package:flutter/material.dart';

/// Warna penanda ambang batas material: hijau aman, kuning mendekati, merah melewati.
Color levelColor(String level) => switch (level) {
      'RED' => const Color(0xFFD32F2F),
      'YELLOW' => const Color(0xFFF9A825),
      _ => const Color(0xFF2E7D32),
    };

String levelLabel(String level) => switch (level) {
      'RED' => 'Melewati batas',
      'YELLOW' => 'Mendekati batas',
      _ => 'Aman',
    };

IconData levelIcon(String level) => switch (level) {
      'RED' => Icons.error,
      'YELLOW' => Icons.warning_amber_rounded,
      _ => Icons.check_circle,
    };

class LevelBadge extends StatelessWidget {
  final String level;
  final bool compact;
  const LevelBadge(this.level, {super.key, this.compact = false});

  @override
  Widget build(BuildContext context) {
    final c = levelColor(level);
    return Container(
      padding: EdgeInsets.symmetric(horizontal: compact ? 6 : 10, vertical: 4),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.12),
        border: Border.all(color: c),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(levelIcon(level), size: 16, color: c),
        if (!compact) ...[
          const SizedBox(width: 4),
          Text(levelLabel(level), style: TextStyle(color: c, fontWeight: FontWeight.w600, fontSize: 12)),
        ],
      ]),
    );
  }
}

/// Bilah progres dengan garis ambang "mendekati" dan "100%".
class ThresholdBar extends StatelessWidget {
  final String label;
  final double pct;
  final int warnPct;
  const ThresholdBar({super.key, required this.label, required this.pct, required this.warnPct});

  @override
  Widget build(BuildContext context) {
    final level = pct > 100 ? 'RED' : pct >= warnPct ? 'YELLOW' : 'GREEN';
    final cs = Theme.of(context).colorScheme;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Expanded(child: Text(label, style: const TextStyle(fontSize: 12))),
        Text('${pct.toStringAsFixed(1)}%',
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: levelColor(level))),
      ]),
      const SizedBox(height: 4),
      LayoutBuilder(builder: (context, c) {
        final w = c.maxWidth;
        // Skala 0–120% agar kelebihan tetap terlihat.
        double x(double p) => w * (p.clamp(0, 120) / 120);
        return SizedBox(
          height: 10,
          child: Stack(children: [
            Container(decoration: BoxDecoration(color: cs.surfaceContainerHighest, borderRadius: BorderRadius.circular(5))),
            Container(
                width: x(pct),
                decoration: BoxDecoration(color: levelColor(level), borderRadius: BorderRadius.circular(5))),
            Positioned(left: x(warnPct.toDouble()), top: 0, bottom: 0, child: Container(width: 2, color: const Color(0xFFF9A825))),
            Positioned(left: x(100) - 1, top: 0, bottom: 0, child: Container(width: 2, color: const Color(0xFFD32F2F))),
          ]),
        );
      }),
    ]);
  }
}
