import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:stories_design_system/stories_design_system.dart';

import '../../../l10n/gen/app_localizations.dart';

/// Member navigation: bottom bar on phones, rail on wider screens.
class MemberShell extends StatelessWidget {
  const MemberShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  void _go(int index) => navigationShell.goBranch(
    index,
    initialLocation: index == navigationShell.currentIndex,
  );

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final destinations = [
      (Icons.home_outlined, Icons.home, l10n.navHome),
      (Icons.explore_outlined, Icons.explore, l10n.navExplore),
      (Icons.auto_stories_outlined, Icons.auto_stories, l10n.navMyBooks),
      (Icons.local_shipping_outlined, Icons.local_shipping, l10n.navOrders),
      (Icons.person_outline, Icons.person, l10n.navProfile),
    ];
    final compact =
        MediaQuery.sizeOf(context).width < StoriesBreakpoints.compact;

    if (compact) {
      return Scaffold(
        body: navigationShell,
        bottomNavigationBar: NavigationBar(
          selectedIndex: navigationShell.currentIndex,
          onDestinationSelected: _go,
          destinations: [
            for (final (icon, selected, label) in destinations)
              NavigationDestination(
                icon: Icon(icon),
                selectedIcon: Icon(selected),
                label: label,
              ),
          ],
        ),
      );
    }

    return Scaffold(
      body: Row(
        children: [
          NavigationRail(
            selectedIndex: navigationShell.currentIndex,
            onDestinationSelected: _go,
            labelType: NavigationRailLabelType.all,
            leading: Padding(
              padding: const EdgeInsets.symmetric(vertical: StoriesSpace.lg),
              child: Icon(
                Icons.auto_stories,
                color: Theme.of(context).colorScheme.primary,
                semanticLabel: l10n.appTitle,
              ),
            ),
            destinations: [
              for (final (icon, selected, label) in destinations)
                NavigationRailDestination(
                  icon: Icon(icon),
                  selectedIcon: Icon(selected),
                  label: Text(label),
                ),
            ],
          ),
          const VerticalDivider(width: 1),
          Expanded(child: navigationShell),
        ],
      ),
    );
  }
}
