// Where an item's music comes from, in a form the engine can load.
import 'catalog.dart';
import 'model.dart';
import 'store.dart';

/// Built-in instrumentals plus the beats and sounds made in the studio.
List<Item> instruments() => [...Store.i.items.where((x) => x.kind == Kind.inst), ...Catalog.i.list(Kind.inst)];

class MusicSource {
  final String? asset, path, url;
  final String label;
  const MusicSource({this.asset, this.path, this.url, this.label = ''});
  bool get none => asset == null && path == null && url == null;
  static const empty = MusicSource();
}

MusicSource instSource(Item inst) {
  final f = inst.m['file'] as String?;
  if (f != null) return MusicSource(path: Store.i.mediaPath(f), label: inst.title);
  if (inst.audioAsset != null) return MusicSource(asset: inst.audioAsset, label: inst.title);
  if (inst.url != null && inst.url!.isNotEmpty && inst.url != 'None') return MusicSource(url: inst.url, label: inst.title);
  return MusicSource.empty;
}

/// Music for an item; [guide] picks the arrangement with the guide melody when there is one.
MusicSource musicFor(Item it, {bool guide = false}) {
  if (it.isCat) {
    if (it.kind == Kind.song) {
      final a = guide && it.audioGuideAsset != null ? it.audioGuideAsset : it.audioAsset;
      return a != null ? MusicSource(asset: a, label: it.title) : MusicSource.empty;
    }
    if (it.kind == Kind.inst) return instSource(it);
    return MusicSource.empty;
  }
  final m = it.music;
  if (m == null) return MusicSource.empty;
  switch (m['type']) {
    case 'file':
      return MusicSource(path: m['path'] as String?, label: '${m['name'] ?? 'Your track'}');
    case 'asset':
      return MusicSource(asset: m['asset'] as String?, label: '${m['name'] ?? ''}');
    case 'inst':
      final inst = Store.i.find('${m['id']}');
      return inst != null ? instSource(inst) : MusicSource.empty;
    case 'cat':
      final s = Catalog.i.get('${m['id']}');
      return s != null ? musicFor(s, guide: guide) : MusicSource.empty;
  }
  return MusicSource.empty;
}

bool hasGuide(Item it) {
  if (it.isCat) return it.audioGuideAsset != null;
  final m = it.music;
  if (m != null && m['type'] == 'cat') {
    final s = Catalog.i.get('${m['id']}');
    return s?.audioGuideAsset != null;
  }
  return false;
}
