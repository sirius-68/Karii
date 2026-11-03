// Built-in catalogue: original poems and movie lines to perform, and Tanner Helland
// instrumentals (CC BY 4.0) to use as background music.
import 'dart:convert';

import 'package:flutter/services.dart';

import 'model.dart';

class Catalog {
  Catalog._();
  static final Catalog i = Catalog._();
  final Map<String, Item> _byId = {};
  final List<String> poets = [];

  Future<void> load() async {
    final j = jsonDecode(await rootBundle.loadString('assets/data/catalog.json')) as Map<String, dynamic>;
    for (final e in (j['items'] as List)) {
      final it = Item((e as Map).cast<String, dynamic>());
      _byId[it.id] = it;
    }
    poets.addAll(((j['poets'] as List?) ?? []).map((e) => '$e'));
  }

  Item? get(String id) => _byId[id];
  List<Item> list(Kind k) => _byId.values.where((x) => x.kind == k).toList();
  Iterable<Item> get all => _byId.values;
}
