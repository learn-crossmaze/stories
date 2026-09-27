import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:stories_design_system/stories_design_system.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../auth/data/auth_repository.dart';

// Member tabs. Until the library modules ship, each tab states truthfully
// that there is nothing to show — no simulated books, loans or orders.

class HomeTab extends ConsumerWidget {
  const HomeTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final user = ref.watch(authStateProvider).value;
    final name = user?.displayName?.split(' ').first;

    return CustomScrollView(
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(
            StoriesSpace.xl,
            StoriesSpace.xxl,
            StoriesSpace.xl,
            StoriesSpace.lg,
          ),
          sliver: SliverToBoxAdapter(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name == null || name.isEmpty
                      ? l10n.greetingFallback
                      : l10n.greeting(name),
                  style: theme.textTheme.headlineLarge,
                ),
                const SizedBox(height: StoriesSpace.xs),
                Text(
                  l10n.tagline,
                  style: theme.textTheme.bodyLarge?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                    fontStyle: FontStyle.italic,
                  ),
                ),
              ],
            ),
          ),
        ),
        SliverFillRemaining(
          hasScrollBody: false,
          child: StoriesEmptyState(
            icon: Icons.card_membership,
            title: l10n.noMembershipTitle,
            message: l10n.noMembershipMessage,
          ),
        ),
      ],
    );
  }
}

class _EmptyTab extends StatelessWidget {
  const _EmptyTab({
    required this.title,
    required this.icon,
    required this.emptyTitle,
    required this.emptyMessage,
  });

  final String title;
  final IconData icon;
  final String emptyTitle;
  final String emptyMessage;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: StoriesEmptyState(
        icon: icon,
        title: emptyTitle,
        message: emptyMessage,
      ),
    );
  }
}

class ExploreTab extends StatelessWidget {
  const ExploreTab({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return _EmptyTab(
      title: l10n.navExplore,
      icon: Icons.menu_book,
      emptyTitle: l10n.exploreEmptyTitle,
      emptyMessage: l10n.exploreEmptyMessage,
    );
  }
}

class MyBooksTab extends StatelessWidget {
  const MyBooksTab({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return _EmptyTab(
      title: l10n.navMyBooks,
      icon: Icons.auto_stories,
      emptyTitle: l10n.myBooksEmptyTitle,
      emptyMessage: l10n.myBooksEmptyMessage,
    );
  }
}

class OrdersTab extends StatelessWidget {
  const OrdersTab({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return _EmptyTab(
      title: l10n.navOrders,
      icon: Icons.local_shipping,
      emptyTitle: l10n.ordersEmptyTitle,
      emptyMessage: l10n.ordersEmptyMessage,
    );
  }
}

class ProfileTab extends ConsumerWidget {
  const ProfileTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final user = ref.watch(authStateProvider).value;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.navProfile)),
      body: ListView(
        padding: const EdgeInsets.all(StoriesSpace.xl),
        children: [
          if (user?.displayName != null)
            Text(user!.displayName!, style: theme.textTheme.headlineSmall),
          if (user?.email != null)
            Text(
              l10n.profileSignedInAs(user!.email!),
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          const SizedBox(height: StoriesSpace.xl),
          OutlinedButton.icon(
            key: const Key('signOut'),
            onPressed: () => ref.read(authRepositoryProvider).signOut(),
            icon: const Icon(Icons.logout),
            label: Text(l10n.signOut),
          ),
        ],
      ),
    );
  }
}
