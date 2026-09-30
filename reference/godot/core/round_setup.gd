extends RefCounted
const Data = preload("res://core/json_data.gd")
## Stable Park-Miller v1. Explicit seed, integer arithmetic, independent of Godot RNG.
## This is reproducibility, not cryptographic fairness against a malicious host.

static func build(config: Dictionary, payload: Dictionary) -> Dictionary:
	if not Data.only_keys(payload, ["round_id", "tiles", "seed", "wall", "dice"]):
		return {"ok": false, "error": "INVALID_SETUP_KEYS"}
	if not Data.identifier(payload.get("round_id")) or not payload.get("tiles") is Array:
		return {"ok": false, "error": "INVALID_SETUP"}
	if payload.tiles.size() != config.tile_count:
		return {"ok": false, "error": "INVALID_TILE_COUNT"}
	var catalog: Dictionary = {}
	var ids: Array = []
	for tile in payload.tiles:
		if not tile is Dictionary or not Data.only_keys(tile, ["id", "glyph", "syllable_key", "base_tone"]):
			return {"ok": false, "error": "INVALID_TILE"}
		if not Data.identifier(tile.get("id")) or catalog.has(tile.id) or not tile.get("glyph") is String or tile.glyph.length() != 1:
			return {"ok": false, "error": "INVALID_TILE"}
		if tile.has("syllable_key") and not Data.identifier(tile.syllable_key):
			return {"ok": false, "error": "INVALID_SYLLABLE_KEY"}
		if tile.has("base_tone") and (not Data.is_integer(tile.base_tone) or tile.base_tone < 1 or tile.base_tone > 4):
			return {"ok": false, "error": "INVALID_BASE_TONE"}
		catalog[tile.id] = tile.duplicate(true)
		ids.append(tile.id)
	var dice: Array = []
	var metadata: Dictionary
	if payload.has("seed"):
		if payload.has("wall") or payload.has("dice") or not Data.is_integer(payload.seed) or payload.seed < 1 or payload.seed > 2147483646:
			return {"ok": false, "error": "INVALID_SEED"}
		var rng := int(payload.seed)
		for index in range(ids.size() - 1, 0, -1):
			rng = (rng * 16807) % 2147483647
			var other := rng % (index + 1)
			var temporary: String = ids[index]
			ids[index] = ids[other]
			ids[other] = temporary
		for index in range(int(config.dice_count)):
			rng = (rng * 16807) % 2147483647
			dice.append(rng % int(config.dice_sides) + 1)
		metadata = {"algorithm": "park-miller-fisher-yates-v1", "seed": int(payload.seed), "dice": dice}
	else:
		if not payload.get("wall") is Array or not payload.get("dice") is Array or payload.wall.size() != ids.size() or payload.dice.size() != config.dice_count:
			return {"ok": false, "error": "INVALID_EXPLICIT_SETUP"}
		var seen: Dictionary = {}
		for id in payload.wall:
			if not id is String or not catalog.has(id) or seen.has(id):
				return {"ok": false, "error": "INVALID_WALL"}
			seen[id] = true
		for die in payload.dice:
			if not Data.is_integer(die) or die < 1 or die > config.dice_sides:
				return {"ok": false, "error": "INVALID_DICE"}
			dice.append(int(die))
		ids = payload.wall.duplicate()
		metadata = {"algorithm": "explicit-v1", "dice": dice}
	var dice_sum := 0
	for die in dice:
		dice_sum += int(die)
	return {"ok": true, "catalog": catalog, "wall": ids, "setup": metadata, "dealer_seat": (int(config.dealer_reference_seat) + dice_sum - 1) % int(config.player_count)}
