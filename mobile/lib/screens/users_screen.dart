import 'package:flutter/material.dart';

import '../config.dart';
import '../main.dart';
import '../models/models.dart';
import '../services/api.dart';
import '../widgets/common.dart';

class UsersScreen extends StatefulWidget {
  const UsersScreen({super.key});
  @override
  State<UsersScreen> createState() => _UsersScreenState();
}

class _UsersScreenState extends State<UsersScreen> {
  final _api = Api.instance;
  List<AppUser> _users = [];
  List<Site> _sites = [];
  bool _loading = true;
  String _search = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final r = await Future.wait([
        _api.get('/users', query: {if (_search.isNotEmpty) 'search': _search}),
        _api.get('/sites', query: {'all': '1'}),
      ]);
      setState(() {
        _users = (r[0]['users'] as List).map((e) => AppUser.fromJson(e as Map<String, dynamic>)).toList();
        _sites = (r[1]['sites'] as List).map((e) => Site.fromJson(e as Map<String, dynamic>)).toList();
      });
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Admin tidak boleh mengelola Superadmin/Admin (sesuai aturan server).
  List<String> get _assignableRoles {
    final me = auth.user!.role;
    return roleLabels.keys
        .where((r) => me == 'SUPERADMIN' || (r != 'SUPERADMIN' && r != 'ADMIN'))
        .toList();
  }

  bool _canEdit(AppUser u) =>
      auth.user!.role == 'SUPERADMIN' || (u.role != 'SUPERADMIN' && u.role != 'ADMIN');

  Future<void> _openForm([AppUser? user]) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => _UserForm(user: user, sites: _sites, roles: _assignableRoles),
    );
    if (saved == true) _load();
  }

  Future<void> _resetPassword(AppUser u) async {
    final ctrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Reset password ${u.username}'),
        content: TextField(
          controller: ctrl,
          obscureText: true,
          decoration: const InputDecoration(
              labelText: 'Password baru', helperText: 'Min. 8 karakter, huruf & angka'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Batal')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Reset')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _api.post('/users/${u.id}/reset-password', {'newPassword': ctrl.text});
      if (mounted) showSnack(context, 'Password ${u.username} berhasil direset');
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    }
  }

  Future<void> _toggleActive(AppUser u) async {
    try {
      await _api.put('/users/${u.id}', {'isActive': !u.isActive});
      _load();
    } catch (e) {
      if (mounted) showSnack(context, e.toString(), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openForm(),
        icon: const Icon(Icons.person_add),
        label: const Text('Tambah'),
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: Constrained(
            child: TextField(
              decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search),
                  hintText: 'Cari nama atau username',
                  border: OutlineInputBorder()),
              onSubmitted: (v) {
                _search = v.trim();
                _load();
              },
            ),
          ),
        ),
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.builder(
                    padding: const EdgeInsets.only(bottom: 88),
                    itemCount: _users.length,
                    itemBuilder: (context, i) {
                      final u = _users[i];
                      final editable = _canEdit(u) && u.id != auth.user!.id;
                      return Constrained(
                        child: ListTile(
                          leading: CircleAvatar(
                              child: Text(u.fullName.isNotEmpty ? u.fullName[0].toUpperCase() : '?')),
                          title: Text(u.fullName,
                              style: TextStyle(
                                  decoration: u.isActive ? null : TextDecoration.lineThrough)),
                          subtitle: Text(
                              '@${u.username} · ${roleLabels[u.role] ?? u.role} · ${u.siteName ?? 'Semua lokasi'}'
                              '${u.isActive ? '' : ' · NONAKTIF'}'),
                          onTap: _canEdit(u) ? () => _openForm(u) : null,
                          trailing: editable
                              ? PopupMenuButton<String>(
                                  onSelected: (v) {
                                    if (v == 'edit') _openForm(u);
                                    if (v == 'reset') _resetPassword(u);
                                    if (v == 'toggle') _toggleActive(u);
                                  },
                                  itemBuilder: (_) => [
                                    const PopupMenuItem(value: 'edit', child: Text('Ubah')),
                                    const PopupMenuItem(value: 'reset', child: Text('Reset password')),
                                    PopupMenuItem(
                                        value: 'toggle',
                                        child: Text(u.isActive ? 'Nonaktifkan' : 'Aktifkan')),
                                  ],
                                )
                              : null,
                        ),
                      );
                    },
                  ),
                ),
        ),
      ]),
    );
  }
}

class _UserForm extends StatefulWidget {
  final AppUser? user;
  final List<Site> sites;
  final List<String> roles;
  const _UserForm({this.user, required this.sites, required this.roles});
  @override
  State<_UserForm> createState() => _UserFormState();
}

class _UserFormState extends State<_UserForm> {
  final _form = GlobalKey<FormState>();
  late final _username = TextEditingController(text: widget.user?.username);
  late final _name = TextEditingController(text: widget.user?.fullName);
  late final _email = TextEditingController(text: widget.user?.email);
  late final _phone = TextEditingController(text: widget.user?.phone);
  final _password = TextEditingController();
  late String _role = widget.user?.role ?? 'LOGISTIK';
  late int? _siteId = widget.user?.siteId;
  bool _busy = false;

  bool get _isNew => widget.user == null;

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      final body = <String, dynamic>{
        'fullName': _name.text.trim(),
        'email': _email.text.trim(),
        'phone': _phone.text.trim(),
        'siteId': _siteId,
      };
      final isSelf = widget.user?.id == auth.user!.id;
      if (!isSelf) body['role'] = _role;
      if (_isNew) {
        body['username'] = _username.text.trim();
        body['password'] = _password.text;
        await Api.instance.post('/users', body);
      } else {
        await Api.instance.put('/users/${widget.user!.id}', body);
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
    final roles = {...widget.roles, if (!_isNew) _role}.toList();
    return AlertDialog(
      title: Text(_isNew ? 'Tambah Pengguna' : 'Ubah Pengguna'),
      content: SizedBox(
        width: 420,
        child: Form(
          key: _form,
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              TextFormField(
                controller: _username,
                enabled: _isNew,
                decoration: const InputDecoration(labelText: 'Username'),
                validator: (v) => (v == null || !RegExp(r'^[a-zA-Z0-9._-]{3,50}$').hasMatch(v.trim()))
                    ? '3-50 karakter: huruf, angka, titik, minus, underscore'
                    : null,
              ),
              TextFormField(
                controller: _name,
                decoration: const InputDecoration(labelText: 'Nama lengkap'),
                validator: (v) => (v == null || v.trim().isEmpty) ? 'Wajib diisi' : null,
              ),
              TextFormField(
                  controller: _email,
                  decoration: const InputDecoration(labelText: 'Email (opsional)'),
                  keyboardType: TextInputType.emailAddress),
              TextFormField(
                  controller: _phone,
                  decoration: const InputDecoration(labelText: 'No. HP (opsional)'),
                  keyboardType: TextInputType.phone),
              if (_isNew)
                TextFormField(
                  controller: _password,
                  obscureText: true,
                  decoration: const InputDecoration(
                      labelText: 'Password awal', helperText: 'Min. 8 karakter, huruf & angka'),
                  validator: (v) {
                    if (v == null || v.length < 8) return 'Minimal 8 karakter';
                    if (!RegExp(r'[A-Za-z]').hasMatch(v) || !RegExp(r'[0-9]').hasMatch(v)) {
                      return 'Harus berisi huruf dan angka';
                    }
                    return null;
                  },
                ),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                value: _role,
                decoration: const InputDecoration(labelText: 'Role'),
                items: [
                  for (final r in roles)
                    DropdownMenuItem(value: r, child: Text(roleLabels[r] ?? r)),
                ],
                onChanged: widget.user?.id == auth.user!.id
                    ? null
                    : (v) => setState(() => _role = v!),
              ),
              DropdownButtonFormField<int?>(
                value: _siteId,
                decoration: const InputDecoration(labelText: 'Lokasi kerja'),
                items: [
                  const DropdownMenuItem<int?>(value: null, child: Text('Semua lokasi (terdekat)')),
                  for (final s in widget.sites)
                    DropdownMenuItem<int?>(
                        value: s.id, child: Text(s.isActive ? s.name : '${s.name} (nonaktif)')),
                ],
                onChanged: (v) => setState(() => _siteId = v),
              ),
            ]),
          ),
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Batal')),
        FilledButton(onPressed: _busy ? null : _save, child: const Text('Simpan')),
      ],
    );
  }
}
