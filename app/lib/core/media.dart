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

/// Background music of an item.
MusicSource musicFor(Item it) {
  if (it.kind == Kind.inst) return instSource(it);
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
  }
  return MusicSource.empty;
}
