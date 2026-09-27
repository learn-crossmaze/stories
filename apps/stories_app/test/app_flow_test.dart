import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stories_app/app/app.dart';
import 'package:stories_app/features/auth/data/auth_repository.dart';
import 'package:stories_app/features/auth/domain/auth_models.dart';

import 'fake_auth_repository.dart';

Future<FakeAuthRepository> pumpApp(
  WidgetTester tester, {
  FakeAuthRepository? repo,
  Size size = const Size(400, 800),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final fake = repo ?? FakeAuthRepository();
  await tester.pumpWidget(
    ProviderScope(
      overrides: [authRepositoryProvider.overrideWithValue(fake)],
      child: const StoriesApp(),
    ),
  );
  await tester.pumpAndSettle();
  return fake;
}

void main() {
  testWidgets('signed-out user sees sign-in', (tester) async {
    await pumpApp(tester);
    expect(find.text('Welcome back'), findsOneWidget);
  });

  testWidgets('validation blocks bad input without calling the backend', (
    tester,
  ) async {
    final repo = await pumpApp(tester);
    await tester.enterText(find.byKey(const Key('email')), 'not-an-email');
    await tester.enterText(find.byKey(const Key('password')), 'short');
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();
    expect(find.text('Enter a valid email address.'), findsOneWidget);
    expect(find.text('Use at least 8 characters.'), findsOneWidget);
    expect(repo.calls, isEmpty);
  });

  testWidgets('sign-in lands on home with greeting and honest empty state', (
    tester,
  ) async {
    await pumpApp(tester);
    await tester.enterText(find.byKey(const Key('email')), 'asha@example.com');
    await tester.enterText(find.byKey(const Key('password')), 'correct-horse');
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();
    expect(find.text('Hello, Asha'), findsOneWidget);
    expect(find.text('No active membership yet'), findsOneWidget);
    expect(find.byType(NavigationBar), findsOneWidget);
  });

  testWidgets('auth failures show a friendly message, not a raw error', (
    tester,
  ) async {
    final repo = FakeAuthRepository(
      failWith: const AuthFailure(AuthFailureCode.invalidCredentials),
    );
    await pumpApp(tester, repo: repo);
    await tester.enterText(find.byKey(const Key('email')), 'asha@example.com');
    await tester.enterText(find.byKey(const Key('password')), 'wrong-pass');
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('authError')), findsOneWidget);
    expect(find.textContaining("don't match"), findsOneWidget);
  });

  testWidgets('create account passes the name and signs in', (tester) async {
    final repo = await pumpApp(tester);
    await tester.tap(find.byKey(const Key('toggleMode')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('fullName')), 'Ravi Kumar');
    await tester.enterText(find.byKey(const Key('email')), 'ravi@example.com');
    await tester.enterText(find.byKey(const Key('password')), 'long-enough');
    await tester.ensureVisible(find.byKey(const Key('submit')));
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();
    expect(repo.calls, contains('create:Ravi Kumar:ravi@example.com'));
    expect(find.text('Hello, Ravi'), findsOneWidget);
  });

  testWidgets('tabs show empty states and sign-out returns to sign-in', (
    tester,
  ) async {
    await pumpApp(
      tester,
      repo: FakeAuthRepository(
        initialUser: const AppUser(uid: 'u1', email: 'asha@example.com'),
      ),
    );
    await tester.tap(find.text('My Books'));
    await tester.pumpAndSettle();
    expect(find.text('No books currently borrowed'), findsOneWidget);
    await tester.tap(find.text('Orders'));
    await tester.pumpAndSettle();
    expect(find.text('No upcoming deliveries'), findsOneWidget);
    await tester.tap(find.text('Profile'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('signOut')));
    await tester.pumpAndSettle();
    expect(find.text('Welcome back'), findsOneWidget);
  });

  testWidgets('wide screens use a navigation rail', (tester) async {
    await pumpApp(
      tester,
      size: const Size(1280, 800),
      repo: FakeAuthRepository(
        initialUser: const AppUser(uid: 'u1', displayName: 'Asha Rao'),
      ),
    );
    expect(find.byType(NavigationRail), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);
  });
}
