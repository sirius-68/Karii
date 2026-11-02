import 'package:flutter/material.dart';

import '../core/store.dart';
import '../widgets/ui.dart';
import 'explore.dart';
import 'library.dart';
import 'onboarding.dart';
import 'profile.dart';
import 'search.dart';
import 'studio_tab.dart';

class Shell extends StatefulWidget {
  const Shell({super.key});
  @override
  State<Shell> createState() => ShellState();
}

class ShellState extends State<Shell> {
  int tab = 0;

  void go(int i) => setState(() => tab = i);

  @override
  void initState() {
    super.initState();
    if (Store.i.profile['onboarded'] != true) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        Navigator.of(context).push(MaterialPageRoute(fullscreenDialog: true, builder: (_) => const Onboarding()));
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      ExploreTab(onTab: go),
      const SearchTab(),
      const StudioTab(),
      const LibraryTab(),
      const ProfileTab(),
    ];
    return Scaffold(
      body: IndexedStack(index: tab, children: pages),
      bottomNavigationBar: NavigationBar(
        backgroundColor: C.s1,
        indicatorColor: C.s3,
        selectedIndex: tab,
        onDestinationSelected: go,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysHide,
        height: 64,
        destinations: const [
          NavigationDestination(icon: Icon(Icons.explore_outlined), selectedIcon: Icon(Icons.explore), label: 'Explore'),
          NavigationDestination(icon: Icon(Icons.search), label: 'Search'),
          NavigationDestination(icon: Icon(Icons.graphic_eq), label: 'Studio'),
          NavigationDestination(icon: Icon(Icons.library_music_outlined), selectedIcon: Icon(Icons.library_music), label: 'Library'),
          NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Profile'),
        ],
      ),
    );
  }
}
