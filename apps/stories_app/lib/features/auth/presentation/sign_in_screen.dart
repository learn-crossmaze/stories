import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:stories_design_system/stories_design_system.dart';

import '../../../core/errors/auth_error_messages.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../data/auth_repository.dart';
import '../domain/auth_models.dart';

class SignInScreen extends StatelessWidget {
  const SignInScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final wide = constraints.maxWidth >= StoriesBreakpoints.medium;
            final form = Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(StoriesSpace.xl),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 420),
                  child: const _AuthForm(),
                ),
              ),
            );
            if (!wide) return form;
            return Row(
              children: [
                const Expanded(child: _EditorialPanel()),
                Expanded(child: form),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _EditorialPanel extends StatelessWidget {
  const _EditorialPanel();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Container(
      margin: const EdgeInsets.all(StoriesSpace.lg),
      padding: const EdgeInsets.all(StoriesSpace.xxxl),
      decoration: BoxDecoration(
        color: scheme.primaryContainer,
        borderRadius: BorderRadius.circular(StoriesRadius.lg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          Icon(Icons.auto_stories, size: 48, color: scheme.onPrimaryContainer),
          const SizedBox(height: StoriesSpace.xl),
          Text(
            'Subscribe once.\nBorrow within your plan.\nExchange as often as you like.',
            style: theme.textTheme.displaySmall?.copyWith(
              color: scheme.onPrimaryContainer,
            ),
          ),
          const SizedBox(height: StoriesSpace.lg),
          Text(
            'Pick up at your library or get books delivered home. '
            'For children, teens and adults.',
            style: theme.textTheme.bodyLarge?.copyWith(
              color: scheme.onPrimaryContainer,
            ),
          ),
        ],
      ),
    );
  }
}

class _AuthForm extends ConsumerStatefulWidget {
  const _AuthForm();

  @override
  ConsumerState<_AuthForm> createState() => _AuthFormState();
}

class _AuthFormState extends ConsumerState<_AuthForm> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _creating = false;
  bool _submitting = false;
  String? _error;

  static final _emailPattern = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function(AuthRepository repo) action) async {
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await action(ref.read(authRepositoryProvider));
    } on AuthFailure catch (failure) {
      if (mounted) {
        setState(() => _error = failure.message(AppLocalizations.of(context)));
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    await _run(
      (repo) => _creating
          ? repo.createAccount(
              fullName: _name.text,
              email: _email.text,
              password: _password.text,
            )
          : repo.signInWithEmail(email: _email.text, password: _password.text),
    );
  }

  Future<void> _resetPassword() async {
    final l10n = AppLocalizations.of(context);
    final email = _email.text.trim();
    if (!_emailPattern.hasMatch(email)) {
      setState(() => _error = l10n.validationEmail);
      return;
    }
    await _run((repo) => repo.sendPasswordReset(email));
    if (mounted && _error == null) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(l10n.resetEmailSent(email))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return Form(
      key: _formKey,
      child: AutofillGroup(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const StoriesWordmark(),
            const SizedBox(height: StoriesSpace.xxl),
            Text(
              _creating ? l10n.createAccountTitle : l10n.signInTitle,
              style: theme.textTheme.headlineMedium,
            ),
            const SizedBox(height: StoriesSpace.xs),
            Text(
              _creating ? l10n.createAccountSubtitle : l10n.signInSubtitle,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: StoriesSpace.xl),
            if (_creating) ...[
              TextFormField(
                key: const Key('fullName'),
                controller: _name,
                decoration: InputDecoration(labelText: l10n.fullNameLabel),
                textInputAction: TextInputAction.next,
                autofillHints: const [AutofillHints.name],
                validator: (v) =>
                    (v ?? '').trim().isEmpty ? l10n.validationName : null,
              ),
              const SizedBox(height: StoriesSpace.md),
            ],
            TextFormField(
              key: const Key('email'),
              controller: _email,
              decoration: InputDecoration(labelText: l10n.emailLabel),
              keyboardType: TextInputType.emailAddress,
              textInputAction: TextInputAction.next,
              autofillHints: const [AutofillHints.email],
              validator: (v) => _emailPattern.hasMatch((v ?? '').trim())
                  ? null
                  : l10n.validationEmail,
            ),
            const SizedBox(height: StoriesSpace.md),
            TextFormField(
              key: const Key('password'),
              controller: _password,
              decoration: InputDecoration(labelText: l10n.passwordLabel),
              obscureText: true,
              textInputAction: TextInputAction.done,
              autofillHints: [
                _creating ? AutofillHints.newPassword : AutofillHints.password,
              ],
              onFieldSubmitted: (_) => _submitting ? null : _submit(),
              validator: (v) =>
                  (v ?? '').length >= 8 ? null : l10n.validationPassword,
            ),
            if (!_creating)
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: _submitting ? null : _resetPassword,
                  child: Text(l10n.forgotPassword),
                ),
              ),
            if (_error != null) ...[
              const SizedBox(height: StoriesSpace.sm),
              Semantics(
                liveRegion: true,
                child: Text(
                  _error!,
                  key: const Key('authError'),
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.error,
                  ),
                ),
              ),
            ],
            const SizedBox(height: StoriesSpace.lg),
            FilledButton(
              key: const Key('submit'),
              onPressed: _submitting ? null : _submit,
              child: _submitting
                  ? const SizedBox.square(
                      dimension: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(
                      _creating ? l10n.createAccountButton : l10n.signInButton,
                    ),
            ),
            const SizedBox(height: StoriesSpace.lg),
            Row(
              children: [
                const Expanded(child: Divider()),
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: StoriesSpace.md,
                  ),
                  child: Text(l10n.orDivider),
                ),
                const Expanded(child: Divider()),
              ],
            ),
            const SizedBox(height: StoriesSpace.lg),
            OutlinedButton.icon(
              onPressed: _submitting
                  ? null
                  : () => _run((repo) => repo.signInWithGoogle()),
              icon: const Icon(Icons.account_circle_outlined),
              label: Text(l10n.continueWithGoogle),
            ),
            const SizedBox(height: StoriesSpace.md),
            TextButton(
              key: const Key('toggleMode'),
              onPressed: _submitting
                  ? null
                  : () => setState(() {
                      _creating = !_creating;
                      _error = null;
                    }),
              child: Text(
                _creating ? l10n.haveAccountButton : l10n.createAccountButton,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
