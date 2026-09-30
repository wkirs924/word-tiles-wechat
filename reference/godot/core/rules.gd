extends RefCounted
const Data = preload("res://core/json_data.gd")

static func defaults() -> Dictionary:
	return {
		"rules_version": "word-tiles-4", "player_count": 4, "tile_count": 136, "initial_hand_size": 13,
		"dice_count": 2, "dice_sides": 6, "dealer_reference_seat": 0,
		"min_sentence_size": 2, "votes_required": 2, "rating_min": 0, "rating_max": 3,
		"planned_rounds": 4, "max_meme_images": 12,
		"sentence_bonuses": [
			{"min": 2, "max": 3, "bonus": 0},
			{"min": 4, "max": 5, "bonus": 1},
			{"min": 6, "max": -1, "bonus": 3}
		]
	}

static func validate(config: Dictionary) -> String:
	var expected := defaults().keys()
	if config.size() != expected.size() or not Data.only_keys(config, expected):
		return "INVALID_CONFIG_KEYS"
	if config.rules_version != "word-tiles-4":
		return "UNSUPPORTED_RULES_VERSION"
	for key in ["player_count", "tile_count", "initial_hand_size", "dice_count", "dice_sides", "dealer_reference_seat", "min_sentence_size", "votes_required", "rating_min", "rating_max", "planned_rounds", "max_meme_images"]:
		if not Data.is_integer(config[key]):
			return "INVALID_CONFIG_NUMBER"
	if config.player_count != 4:
		return "UNSUPPORTED_PLAYER_COUNT"
	if config.max_meme_images < 1 or config.max_meme_images > 100:
		return "INVALID_MEME_LIMIT"
	if config.dice_count < 1 or config.dice_count > 16 or config.dice_sides < 2 or config.dice_sides > 100 or config.dealer_reference_seat < 0 or config.dealer_reference_seat >= 4:
		return "INVALID_DICE_CONFIG"
	if config.initial_hand_size < 1 or config.tile_count < 4 * config.initial_hand_size + 1 or config.tile_count > 10000:
		return "INVALID_DEAL_CONFIG"
	if config.min_sentence_size < 2 or config.min_sentence_size > config.tile_count:
		return "INVALID_SENTENCE_MINIMUM"
	if config.votes_required < 1 or config.votes_required > 3 or config.rating_min < 0 or config.rating_max < config.rating_min or config.rating_max > 100 or config.planned_rounds < 1:
		return "INVALID_SCORING_CONFIG"
	if not config.sentence_bonuses is Array or config.sentence_bonuses.is_empty():
		return "INVALID_BONUS_TABLE"
	var next_min := int(config.min_sentence_size)
	for index in range(config.sentence_bonuses.size()):
		var band: Variant = config.sentence_bonuses[index]
		if not band is Dictionary or band.size() != 3 or not Data.only_keys(band, ["min", "max", "bonus"]):
			return "INVALID_BONUS_TABLE"
		for key in ["min", "max", "bonus"]:
			if not Data.is_integer(band[key]):
				return "INVALID_BONUS_TABLE"
		if band.min != next_min or band.bonus < 0 or band.bonus > 10000:
			return "INVALID_BONUS_TABLE"
		if index == config.sentence_bonuses.size() - 1:
			if band.max != -1:
				return "INVALID_BONUS_TABLE"
		elif band.max < band.min:
			return "INVALID_BONUS_TABLE"
		next_min = int(band.max) + 1
	return ""

static func sentence_score(config: Dictionary, count: int) -> Dictionary:
	for band in config.sentence_bonuses:
		if count >= band.min and (band.max == -1 or count <= band.max):
			return {"base": count, "bonus": int(band.bonus), "total": count + int(band.bonus)}
	return {"base": count, "bonus": 0, "total": count}

# Empty images are legal: a sentence can be submitted without memes.
static func validate_resource_keys(keys: Variant, limit: int) -> String:
	if not keys is Array: return "INVALID_RESOURCE_KEYS"
	if keys.size() > limit: return "INVALID_MEME_COUNT"
	var seen: Dictionary = {}
	for key in keys:
		if not Data.identifier(key) or "/" in key or "\\" in key or ":" in key:
			return "RESOURCE_KEY_REQUIRED"
		if seen.has(key): return "DUPLICATE_MEME_IMAGE"
		seen[key] = true
	return ""
