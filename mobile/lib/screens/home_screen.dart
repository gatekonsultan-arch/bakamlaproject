import 'package:flutter/material.dart';

import '../config.dart';
import '../main.dart';
import 'attendance_screen.dart';
import 'history_screen.dart';
import 'profile_screen.dart';
import 'report_screen.dart';
import 'sites_screen.dart';
import 'users_screen.dart';

class _Dest {
  final String label;
  final IconData icon;
  final Widget page;
  const _Dest(this.label, this.icon, this.page);
}

/// Kerangka utama: menu muncul sesuai role. Bottom bar di HP, rail di layar lebar.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _index = 0;

  List<_Dest> _destinations(String role) => [
        const _Dest('Absen', Icons.fingerprint, AttendanceScreen()),
        const _Dest('Riwayat', Icons.history, HistoryScreen()),
        if (canViewReports(role)) const _Dest('Laporan', Icons.assessment_outlined, ReportScreen()),
        if (canManageUsers(role)) const _Dest('Pengguna', Icons.group_outlined, UsersScreen()),
        if (canManageSites(role)) const _Dest('Lokasi', Icons.place_outlined, SitesScreen()),
        const _Dest('Profil', Icons.person_outline, ProfileScreen()),
      ];

  @override
  Widget build(BuildContext context) {
    final user = auth.user!;
    final dests = _destinations(user.role);
    if (_index >= dests.length) _index = 0;
    final wide = MediaQuery.sizeOf(context).width >= 840;

    final body = IndexedStack(index: _index, children: [for (final d in dests) d.page]);

    return Scaffold(
      appBar: AppBar(
        title: Text(dests[_index].label),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: Center(
              child: Text('${user.fullName} · ${roleLabels[user.role] ?? user.role}',
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall),
            ),
          ),
        ],
      ),
      body: wide
          ? Row(children: [
              NavigationRail(
                selectedIndex: _index,
                onDestinationSelected: (i) => setState(() => _index = i),
                labelType: NavigationRailLabelType.all,
                destinations: [
                  for (final d in dests)
                    NavigationRailDestination(icon: Icon(d.icon), label: Text(d.label)),
                ],
              ),
              const VerticalDivider(width: 1),
              Expanded(child: body),
            ])
          : body,
      bottomNavigationBar: wide
          ? null
          : NavigationBar(
              selectedIndex: _index,
              onDestinationSelected: (i) => setState(() => _index = i),
              destinations: [
                for (final d in dests) NavigationDestination(icon: Icon(d.icon), label: d.label),
              ],
            ),
    );
  }
}
