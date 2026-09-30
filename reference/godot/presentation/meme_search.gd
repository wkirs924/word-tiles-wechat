extends RefCounted
## Pure data presentation helper; never called by the rule reducer.
## Search filters first, then distinct selected glyph matches rank results.
static func rank(assets: Array, query: String, glyphs: Array) -> Array:
	var result: Array = []
	var unique: Dictionary = {}
	for glyph in glyphs:
		if glyph is String and not glyph.is_empty(): unique[glyph] = true
	var needle := query.strip_edges().to_lower()
	for asset in assets:
		if asset.kind != "meme": continue
		var keywords: String = " ".join(asset.keywords).to_lower()
		if not needle.is_empty() and not (str(asset.title).to_lower() + " " + keywords).contains(needle): continue
		var matches: Array = []
		for glyph in unique:
			if keywords.contains(glyph.to_lower()): matches.append(glyph)
		var item: Dictionary = asset.duplicate(true)
		item["match_count"] = matches.size()
		item["matched_glyphs"] = matches
		var position := 0
		while position < result.size() and result[position].match_count >= matches.size(): position += 1
		result.insert(position, item)
	return result
