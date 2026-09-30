extends RefCounted
const Search = preload("res://presentation/meme_search.gd")
var checks := 0
var failures := 0

func check(value: bool, message: String) -> void:
	checks += 1
	if not value:
		failures += 1
		push_error("FAIL: search " + message)

func run() -> bool:
	var assets := [
		{"key": "a", "kind": "meme", "title": "first", "keywords": ["开门"]},
		{"key": "b", "kind": "meme", "title": "second", "keywords": ["开心", "开心", "快乐"]},
		{"key": "c", "kind": "meme", "title": "third", "keywords": ["心情"]},
		{"key": "ui", "kind": "ui", "title": "decoration", "keywords": ["开心"]}
	]
	var snapshot := JSON.stringify(assets)
	var ranked := Search.rank(assets, "", ["开", "心"])
	check(ranked[0].key == "b" and ranked[0].match_count == 2, "more distinct selected glyphs rank first")
	check(ranked[1].key == "a" and ranked[2].key == "c", "equal scores retain catalog order")
	check(Search.rank(assets, "", ["开", "开", "心"])[0].match_count == 2, "duplicate tiles/keywords do not inflate score")
	check(Search.rank(assets, "", ["心"])[0].key == "b", "one character matches multi-character keyword")
	check(Search.rank(assets, "", [])[0].key == "a", "deselection restores original order")
	check(Search.rank(assets, "开心", ["开"])[0].key == "b", "search filters before ranking")
	check(Search.rank(assets, " FIRST ", []).size() == 1, "trimmed case-insensitive title search")
	check(Search.rank(assets, "missing", []).is_empty(), "empty search results")
	check(ranked.size() == 3, "UI assets excluded")
	ranked[0].keywords.append("changed")
	check(JSON.stringify(assets) == snapshot, "ranking returns detached data and never changes catalog")
	assets[0].keywords = ["开心"]
	check(Search.rank(assets, "", ["开", "心"])[0].key == "a", "edited keywords immediately affect ranking")
	return true
