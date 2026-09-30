extends RefCounted
const Data = preload("res://core/json_data.gd")
const Rules = preload("res://core/rules.gd")
## Expensive diagnostic checks for tests/debug, not a client-supplied state importer.

static func check(state: Dictionary) -> Array:
	var errors: Array = []
	if not Data.is_json(state):
		errors.append("State is not JSON-safe")
	if state.wall_cursor < 0 or state.wall_cursor > state.wall.size():
		errors.append("Invalid wall cursor")
	var all: Array = state.wall.slice(int(state.wall_cursor))
	var totals: Dictionary = {}
	var bonuses: Dictionary = {}
	for player in state.players:
		all.append_array(state.hands[player])
		all.append_array(state.rivers[player])
		totals[player] = 0
		bonuses[player] = 0
	for sentence in state.sentences:
		all.append_array(sentence.tile_ids)
		var expected := Rules.sentence_score(state.config, sentence.tile_ids.size())
		if sentence.score != expected:
			errors.append("Sentence score mismatch")
		totals[sentence.owner_id] += int(expected.total)
		bonuses[sentence.owner_id] += int(sentence.rating_average.numerator)
		if sentence.rating_average.denominator != 3 or not Rules.validate_resource_keys(sentence.resource_keys, int(state.config.max_meme_images)).is_empty():
			errors.append("Invalid accepted sentence metadata")
	if bonuses != state.rating_bonus_thirds:
		errors.append("Accumulated rating bonus mismatch")
	if totals != state.scores:
		errors.append("Accumulated sentence points mismatch")
	var seen: Dictionary = {}
	for id in all:
		if seen.has(id) or not state.catalog.has(id):
			errors.append("Duplicate or unknown physical tile: " + str(id))
		seen[id] = true
	if all.size() != state.config.tile_count or seen.size() != state.catalog.size():
		errors.append("Tile conservation violated")
	if (state.phase == "AWAIT_VOTES") != (state.pending != null):
		errors.append("Pending sentence/phase mismatch")
	if state.pending != null:
		var pending_seen: Dictionary = {}
		for id in state.pending.tile_ids:
			if id not in state.hands[state.pending.owner_id] or pending_seen.has(id):
				errors.append("Pending sentence does not reference distinct owned tiles")
			pending_seen[id] = true
		if state.pending.votes.has(state.pending.owner_id) or state.pending.votes.size() > 3:
			errors.append("Invalid pending voters")
	if state.winner_id != null and not state.hands[state.winner_id].is_empty():
		errors.append("Winner still holds tiles")
	if state.phase == "COMPLETED":
		if state.result == null or state.end_reason not in ["WIN", "WALL_EXHAUSTED"]:
			errors.append("Missing completed result")
		else:
			for player in state.players:
				var score: Dictionary = state.result.scores[player]
				var rating_sum := int(state.rating_bonus_thirds[player])
				if score.total.numerator != rating_sum + 3 * (int(state.scores[player]) - state.hands[player].size()):
					errors.append("Final score mismatch")
	return errors
