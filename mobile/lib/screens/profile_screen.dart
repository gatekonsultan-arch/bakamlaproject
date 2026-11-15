import 'package:flutter/material.dart';

import '../config.dart';
import '../main.dart';
import '../widgets/common.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final u = auth.user!;
    return ListView(padding: const EdgeInsets.all(16), children: [
      Constrained(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Card(
            child: Column(children: [
              ListTile(
                  leading: const Icon(Icons.badge_outlined),
                  title: Text(u.fullName),
                  subtitle: Text('@${u.username}')),
              ListTile(
                  leading: const Icon(Icons.verified_user_outlined),
                  title: const Text('Role'),
                  subtitle: Text(roleLabels[u.role] ?? u.role)),
              ListTile(
                  leading: const Icon(Icons.place_outlined),
                  title: const Text('Lokasi kerja'),
                  subtitle: Text(u.siteName ?? 'Semua lokasi (terdekat)')),
            ]),
          ),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: () => showDialog(context: context, builder: (_) => const _ChangePasswordDialog()),
            icon: const Icon(Icons.password),
            label: const Text('Ganti Password'),
          ),
          const SizedBox(height: 8),
          FilledButton.tonalIcon(
            onPressed: () => auth.logout(),
            icon: const Icon(Icons.logout),
            label: const Text('Keluar'),
          ),
        ]),
      ),
    ]);
  }
}

class _ChangePasswordDialog extends StatefulWidget {
  const _ChangePasswordDialog();
  @override
  State<_ChangePasswordDialog> createState() => _ChangePasswordDialogState();
}

class _ChangePasswordDialogState extends State<_ChangePasswordDialog> {
  final _form = GlobalKey<FormState>();
  final _old = TextEditingController();
  final _new = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      await auth.changePassword(_old.text, _new.text);
      if (!mounted) return;
      Navigator.pop(context);
      showSnack(context, 'Password berhasil diubah');
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('Ganti Password'),
        content: Form(
          key: _form,
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            TextFormField(
                controller: _old,
                obscureText: true,
                decoration: const InputDecoration(labelText: 'Password lama'),
                validator: (v) => (v == null || v.isEmpty) ? 'Wajib diisi' : null),
            TextFormField(
                controller: _new,
                obscureText: true,
                decoration: const InputDecoration(
                    labelText: 'Password baru', helperText: 'Min. 8 karakter, huruf & angka'),
                validator: (v) {
                  if (v == null || v.length < 8) return 'Minimal 8 karakter';
                  if (!RegExp(r'[A-Za-z]').hasMatch(v) || !RegExp(r'[0-9]').hasMatch(v)) {
                    return 'Harus berisi huruf dan angka';
                  }
                  return null;
                }),
            TextFormField(
                controller: _confirm,
                obscureText: true,
                decoration: const InputDecoration(labelText: 'Ulangi password baru'),
                validator: (v) => v != _new.text ? 'Password tidak sama' : null),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Batal')),
          FilledButton(onPressed: _busy ? null : _save, child: const Text('Simpan')),
        ],
      );
}
