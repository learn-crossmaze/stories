import 'dart:async';

import 'package:stories_app/features/auth/data/auth_repository.dart';
import 'package:stories_app/features/auth/domain/auth_models.dart';

/// In-memory [AuthRepository] for widget tests.
class FakeAuthRepository implements AuthRepository {
  FakeAuthRepository({AppUser? initialUser, this.failWith})
    : _user = initialUser;

  AppUser? _user;
  AuthFailure? failWith;
  final _controller = StreamController<AppUser?>.broadcast();
  final calls = <String>[];

  void _emit(AppUser? user) {
    _user = user;
    _controller.add(user);
  }

  @override
  Stream<AppUser?> authStateChanges() async* {
    yield _user;
    yield* _controller.stream;
  }

  @override
  AppUser? get currentUser => _user;

  @override
  Future<void> signInWithEmail({
    required String email,
    required String password,
  }) async {
    calls.add('signIn:$email');
    if (failWith != null) throw failWith!;
    _emit(AppUser(uid: 'u1', email: email, displayName: 'Asha Rao'));
  }

  @override
  Future<void> createAccount({
    required String fullName,
    required String email,
    required String password,
  }) async {
    calls.add('create:$fullName:$email');
    if (failWith != null) throw failWith!;
    // Mirrors Firebase: the user signs in first, then the profile name is
    // set in a second step and arrives as a separate event.
    _emit(AppUser(uid: 'u1', email: email));
    await Future<void>.delayed(Duration.zero);
    _emit(AppUser(uid: 'u1', email: email, displayName: fullName));
  }

  @override
  Future<void> signInWithGoogle() async => calls.add('google');

  @override
  Future<void> sendPasswordReset(String email) async =>
      calls.add('reset:$email');

  @override
  Future<void> signOut() async {
    calls.add('signOut');
    _emit(null);
  }
}
