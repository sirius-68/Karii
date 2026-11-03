// Compact floating progress indicator for background jobs, shown above every screen.
import 'package:flutter/material.dart';

import '../core/jobs.dart';
import 'ui.dart';

class JobPill extends StatefulWidget {
  /// Screens that need the whole display (the stage) hide the pill while they're open.
  static final ValueNotifier<int> hiddenBy = ValueNotifier(0);

  final void Function(Job) onOpen;
  /// A context below the app's Navigator (the pill itself sits above it).
  final BuildContext? Function() navContext;
  const JobPill({super.key, required this.onOpen, required this.navContext});
  @override
  State<JobPill> createState() => _JobPillState();
}

class _JobPillState extends State<JobPill> {
  final Set<String> hidden = {};

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: Listenable.merge([Jobs.i, JobPill.hiddenBy]),
      builder: (context, _) {
        if (JobPill.hiddenBy.value > 0) return const SizedBox.shrink();
        final list = Jobs.i.visible.where((j) => !hidden.contains(j.id)).toList();
        if (list.isEmpty) return const SizedBox.shrink();
        final j = list.firstWhere((x) => x.active, orElse: () => list.first);
        final more = list.length - 1;
        final done = j.state == JobState.done, failed = j.state == JobState.error;
        return Material(
          color: C.s3,
          elevation: 6,
          shadowColor: Colors.black54,
          shape: const StadiumBorder(),
          child: InkWell(
            customBorder: const StadiumBorder(),
            onTap: () {
              final c = widget.navContext();
              if (done) {
                widget.onOpen(j);
              } else if (c != null) {
                _sheet(c);
              }
            },
            child: Padding(
              padding: const EdgeInsets.fromLTRB(10, 8, 6, 8),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                SizedBox(
                  width: 22,
                  height: 22,
                  child: done
                      ? const Icon(Icons.check_circle, color: C.green, size: 22)
                      : failed
                          ? const Icon(Icons.error_outline, color: C.hot, size: 22)
                          : CircularProgressIndicator(strokeWidth: 2.5, value: j.progress > 1 ? j.progress / 100 : null, color: Colors.white, backgroundColor: C.s4),
                ),
                const SizedBox(width: 10),
                ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 220),
                  child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(j.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                    Text(more > 0 ? '${j.label} · +$more more' : (done ? 'Ready · tap to open' : j.label),
                        maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: C.muted)),
                  ]),
                ),
                IconButton(
                  visualDensity: VisualDensity.compact,
                  onPressed: () => setState(() => hidden.add(j.id)),
                  icon: const Icon(Icons.close, size: 16, color: C.muted),
                ),
              ]),
            ),
          ),
        );
      },
    );
  }

  void _sheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      backgroundColor: C.s1,
      builder: (c) => AnimatedBuilder(
        animation: Jobs.i,
        builder: (c, _) {
          final list = Jobs.i.jobs.take(12).toList();
          return SafeArea(
            child: ListView(shrinkWrap: true, padding: const EdgeInsets.fromLTRB(0, 0, 0, 12), children: [
              const Padding(padding: EdgeInsets.fromLTRB(20, 0, 20, 8), child: Text('Background work', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700))),
              if (list.isEmpty) const Padding(padding: EdgeInsets.all(20), child: Text('Nothing running.', style: TextStyle(color: C.muted))),
              for (final j in list)
                ListTile(
                  title: Text(j.title, maxLines: 1, overflow: TextOverflow.ellipsis),
                  subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(j.label, style: TextStyle(color: j.state == JobState.error ? C.hot : C.muted)),
                    if (j.active) Padding(padding: const EdgeInsets.only(top: 6), child: LinearProgressIndicator(value: j.progress > 1 ? j.progress / 100 : null)),
                  ]),
                  trailing: j.active
                      ? TextButton(onPressed: () => Jobs.i.cancel(j), child: const Text('Cancel'))
                      : j.state == JobState.done
                          ? TextButton(
                              onPressed: () {
                                Navigator.pop(c);
                                widget.onOpen(j);
                              },
                              child: const Text('Open'))
                          : j.state == JobState.error || j.state == JobState.cancelled
                              ? Row(mainAxisSize: MainAxisSize.min, children: [
                                  TextButton(onPressed: () => Jobs.i.retry(j), child: const Text('Retry')),
                                  IconButton(onPressed: () => Jobs.i.remove(j), icon: const Icon(Icons.close, size: 18)),
                                ])
                              : null,
                ),
            ]),
          );
        },
      ),
    );
  }
}
