import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/data/auth_repository.dart';
import '../../features/auth/presentation/sign_in_screen.dart';
import '../../features/member/presentation/member_shell.dart';
import '../../features/member/presentation/member_tabs.dart';

abstract final class Routes {
  static const signIn = '/sign-in';
  static const home = '/';
  static const explore = '/explore';
  static const myBooks = '/my-books';
  static const orders = '/orders';
  static const profile = '/profile';
}

/// Pure redirect rule, kept separate so it can be unit tested.
String? authRedirect({required bool signedIn, required String location}) {
  final onSignIn = location == Routes.signIn;
  if (!signedIn) return onSignIn ? null : Routes.signIn;
  if (onSignIn) return Routes.home;
  return null;
}

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier<int>(0);
  ref.listen(authStateProvider, (_, _) => refresh.value++);
  ref.onDispose(refresh.dispose);

  GoRoute tab(String path, Widget child) => GoRoute(
    path: path,
    pageBuilder: (_, _) => NoTransitionPage(child: child),
  );

  return GoRouter(
    initialLocation: Routes.home,
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authStateProvider);
      // Wait for the first auth event before deciding.
      if (auth.isLoading && !auth.hasValue) return null;
      return authRedirect(
        signedIn: auth.value != null,
        location: state.matchedLocation,
      );
    },
    routes: [
      GoRoute(path: Routes.signIn, builder: (_, _) => const SignInScreen()),
      StatefulShellRoute.indexedStack(
        builder: (_, _, shell) => MemberShell(navigationShell: shell),
        branches: [
          StatefulShellBranch(routes: [tab(Routes.home, const HomeTab())]),
          StatefulShellBranch(
            routes: [tab(Routes.explore, const ExploreTab())],
          ),
          StatefulShellBranch(
            routes: [tab(Routes.myBooks, const MyBooksTab())],
          ),
          StatefulShellBranch(routes: [tab(Routes.orders, const OrdersTab())]),
          StatefulShellBranch(
            routes: [tab(Routes.profile, const ProfileTab())],
          ),
        ],
      ),
    ],
  );
});
