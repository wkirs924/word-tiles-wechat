extends RefCounted
const Rules = preload("res://core/rules.gd")
const Setup = preload("res://core/round_setup.gd")
const Data = preload("res://core/json_data.gd")
## Single-round rules. Inputs are trusted state + validated JSON command + bound identity.
## Returns a new state. Failed actions never mutate the input or emit events.

static func start(players: Array, config: Dictionary, payload: Dictionary) -> Dictionary:
	var setup := Setup.build(config, payload)
	if not setup.ok:
		return setup
	var state := {
		"schema_version": 1, "round_id": payload.round_id, "config": config.duplicate(true),
		"players": players.duplicate(), "catalog": setup.catalog, "wall": setup.wall,
		"setup": setup.setup, "wall_cursor": 0, "dealer_seat": setup.dealer_seat,
		"active_seat": setup.dealer_seat, "turn_id": 1, "phase": "AWAIT_ACTION",
		"hands": {}, "rivers": {}, "sentences": [], "scores": {}, "pending": null,
		"winner_id": null, "end_reason": null, "rating_bonus_thirds": {}, "result": null
	}
	for player in players:
		state.hands[player] = []
		state.rivers[player] = []
		state.scores[player] = 0
		state.rating_bonus_thirds[player] = 0
	for index in range(int(config.initial_hand_size)):
		for offset in range(4):
			_deal_one(state, players[(int(setup.dealer_seat) + offset) % 4])
	_deal_one(state, players[int(setup.dealer_seat)])
	var events: Array = []
	_emit(events, "ROUND_STARTED", {"dealer_id": players[int(setup.dealer_seat)], "dice": setup.setup.dice})
	for player in players:
		_emit(events, "HAND_DEALT", {"player_id": player, "count": state.hands[player].size()}, {player: {"tiles": tile_records(state, state.hands[player])}})
	_emit(events, "TURN_STARTED", {"player_id": active_player(state), "turn_id": 1, "must_draw": false})
	return {"ok": true, "state": state, "events": events}

static func reduce(previous: Dictionary, command: Dictionary, actor: String, is_host: bool) -> Dictionary:
	var state := previous.duplicate(true)
	var events: Array = []
	var kind: String = command.type
	var payload: Dictionary = command.payload
	if command.get("round_id") != state.round_id:
		return _failure("STALE_ROUND")
	if state.phase in ["COMPLETED", "ABORTED"]:
		return _failure("ROUND_TERMINAL")
	if kind == "END_GAME":
		if not is_host:
			return _failure("HOST_REQUIRED")
		if not payload.is_empty():
			return _failure("INVALID_PAYLOAD")
		if state.pending != null:
			_emit(events, "SENTENCE_CANCELLED", {"proposal_id": state.pending.id})
		state.pending = null
		state.phase = "ABORTED"
		state.end_reason = "HOST_ABORT"
		_emit(events, "ROUND_ABORTED", {"winner_id": state.winner_id})
		return {"ok": true, "state": state, "events": events}
	if kind in ["DRAW_TILE", "DISCARD_TILE", "PROPOSE_SENTENCE"]:
		if not Data.is_integer(command.get("turn_id")) or command.turn_id != state.turn_id:
			return _failure("STALE_TURN")
		if actor != active_player(state) and not (kind == "DRAW_TILE" and is_host):
			return _failure("NOT_YOUR_TURN")
	var error := ""
	match kind:
		"DRAW_TILE": error = _draw(state, payload, events)
		"DISCARD_TILE": error = _discard(state, payload, events)
		"PROPOSE_SENTENCE": error = _propose(state, payload, events)
		"SUBMIT_VOTE": error = _vote(state, command, actor, events)
		_: error = "UNKNOWN_ACTION"
	if not error.is_empty():
		return _failure(error)
	return {"ok": true, "state": state, "events": events}

static func active_player(state: Dictionary) -> String:
	return state.players[int(state.active_seat)]

static func tile_records(state: Dictionary, ids: Array) -> Array:
	var records: Array = []
	for id in ids:
		records.append(state.catalog[id].duplicate(true))
	return records

static func _failure(error: String) -> Dictionary:
	return {"ok": false, "error": error}

static func _emit(events: Array, kind: String, public_data: Dictionary, private_data: Dictionary = {}) -> void:
	events.append({"type": kind, "public": public_data.duplicate(true), "private": private_data.duplicate(true)})

static func _deal_one(state: Dictionary, player: String) -> String:
	var id: String = state.wall[int(state.wall_cursor)]
	state.wall_cursor += 1
	state.hands[player].append(id)
	return id

static func _draw(state: Dictionary, payload: Dictionary, events: Array) -> String:
	if state.phase != "AWAIT_DRAW":
		return "WRONG_PHASE"
	if not payload.is_empty():
		return "INVALID_PAYLOAD"
	if state.wall_cursor == state.wall.size():
		_begin_settlement(state, "WALL_EXHAUSTED", events)
		return ""
	var player := active_player(state)
	var id := _deal_one(state, player)
	state.phase = "AWAIT_ACTION"
	_emit(events, "TILE_DRAWN", {"player_id": player, "wall_remaining": state.wall.size() - state.wall_cursor}, {player: {"tile": state.catalog[id]}})
	return ""

static func _discard(state: Dictionary, payload: Dictionary, events: Array) -> String:
	if state.phase not in ["AWAIT_ACTION", "MUST_DISCARD"]:
		return "WRONG_PHASE"
	if payload.size() != 1 or not payload.get("tile_id") is String:
		return "INVALID_PAYLOAD"
	var player := active_player(state)
	if payload.tile_id not in state.hands[player]:
		return "TILE_NOT_OWNED"
	state.hands[player].erase(payload.tile_id)
	state.rivers[player].append(payload.tile_id)
	_emit(events, "TILE_DISCARDED", {"player_id": player, "tile": state.catalog[payload.tile_id]})
	_advance_turn(state, events)
	return ""

static func _propose(state: Dictionary, payload: Dictionary, events: Array) -> String:
	if state.phase != "AWAIT_ACTION":
		return "WRONG_PHASE"
	if not Data.only_keys(payload, ["tile_ids", "reading_choices", "resource_keys"]) or not payload.get("tile_ids") is Array:
		return "INVALID_PAYLOAD"
	var keys: Variant = payload.get("resource_keys", [])
	var image_error := Rules.validate_resource_keys(keys, int(state.config.max_meme_images))
	if not image_error.is_empty(): return image_error
	var ids: Array = payload.tile_ids
	var player := active_player(state)
	if ids.size() < state.config.min_sentence_size or ids.size() > state.hands[player].size():
		return "INVALID_SENTENCE_SIZE"
	var seen: Dictionary = {}
	var characters: Array = []
	var text := ""
	for id in ids:
		if not id is String or id not in state.hands[player] or seen.has(id):
			return "INVALID_SENTENCE_TILES"
		seen[id] = true
		characters.append(state.catalog[id].glyph)
		text += state.catalog[id].glyph
	var readings: Array = []
	readings.resize(ids.size())
	if payload.has("reading_choices"):
		if not payload.reading_choices is Array or payload.reading_choices.size() != ids.size():
			return "INVALID_READINGS"
		for reading in payload.reading_choices:
			if reading == null:
				continue
			if not reading is Dictionary or reading.size() != 1 or not Data.is_integer(reading.get("tone")) or reading.tone < 1 or reading.tone > 4:
				return "INVALID_READINGS"
		readings = payload.reading_choices.duplicate(true)
	state.pending = {
		"id": state.round_id + ":" + str(int(state.turn_id)), "owner_id": player,
		"tile_ids": ids.duplicate(), "characters": characters, "text": text,
		"reading_choices": readings, "resource_keys": keys.duplicate(), "votes": {}
	}
	state.phase = "AWAIT_VOTES"
	var public_proposal: Dictionary = state.pending.duplicate(true)
	public_proposal.erase("votes")
	_emit(events, "SENTENCE_PROPOSED", public_proposal)
	return ""

static func _vote(state: Dictionary, command: Dictionary, actor: String, events: Array) -> String:
	if state.phase != "AWAIT_VOTES":
		return "WRONG_PHASE"
	if command.get("proposal_id") != state.pending.id:
		return "STALE_PROPOSAL"
	var payload: Dictionary = command.payload
	if payload.size() != 2 or not payload.get("approve") is bool or not Data.is_integer(payload.get("rating")):
		return "INVALID_PAYLOAD"
	if not state.pending.resource_keys.is_empty() and (payload.rating < state.config.rating_min or payload.rating > state.config.rating_max):
		return "RATING_OUT_OF_RANGE"
	if actor == state.pending.owner_id:
		return "SELF_VOTE_FORBIDDEN"
	if state.pending.resource_keys.is_empty() and payload.rating != 0:
		return "RATING_REQUIRES_MEME"
	if state.pending.votes.has(actor):
		return "ALREADY_VOTED"
	state.pending.votes[actor] = {"approve": payload.approve, "rating": int(payload.rating)}
	_emit(events, "VOTE_SUBMITTED", {"proposal_id": state.pending.id, "votes_received": state.pending.votes.size()})
	if state.pending.votes.size() < 3:
		return ""
	var yes := 0
	var rating_sum := 0
	for vote in state.pending.votes.values():
		rating_sum += int(vote.rating)
		if vote.approve:
			yes += 1
	var proposal: Dictionary = state.pending
	state.pending = null
	if yes < state.config.votes_required:
		state.phase = "MUST_DISCARD"
		_emit(events, "SENTENCE_REJECTED", {"proposal_id": proposal.id, "approvals": yes, "oppositions": 3 - yes})
		return ""
	var player: String = proposal.owner_id
	for id in proposal.tile_ids:
		state.hands[player].erase(id)
	proposal.erase("votes")
	proposal["score"] = Rules.sentence_score(state.config, proposal.tile_ids.size())
	proposal["approvals"] = yes
	proposal["rating_average"] = {"numerator": rating_sum, "denominator": 3}
	state.sentences.append(proposal)
	state.scores[player] += proposal.score.total
	state.rating_bonus_thirds[player] += rating_sum
	_emit(events, "SENTENCE_ACCEPTED", {"sentence": proposal})
	if state.hands[player].is_empty():
		state.winner_id = player
		_emit(events, "PLAYER_WON", {"player_id": player})
		_begin_settlement(state, "WIN", events)
	else:
		_advance_turn(state, events)
	return ""

static func _advance_turn(state: Dictionary, events: Array) -> void:
	state.active_seat = (int(state.active_seat) + 1) % 4
	state.turn_id += 1
	state.phase = "AWAIT_DRAW"
	_emit(events, "TURN_STARTED", {"player_id": active_player(state), "turn_id": state.turn_id, "must_draw": true})

static func _begin_settlement(state: Dictionary, reason: String, events: Array) -> void:
	state.end_reason = reason
	_emit(events, "SETTLEMENT_STARTED", {"reason": reason, "winner_id": state.winner_id})
	_complete(state, events)

static func _complete(state: Dictionary, events: Array) -> void:
	var scores: Dictionary = {}
	for player in state.players:
		var sum := int(state.rating_bonus_thirds[player])
		var remaining: int = state.hands[player].size()
		scores[player] = {
			"sentence_points": int(state.scores[player]), "remaining_tiles": remaining,
			"rating_bonus": {"numerator": sum, "denominator": 3},
			"total": {"numerator": sum + 3 * (int(state.scores[player]) - remaining), "denominator": 3}
		}
	state.result = {"round_id": state.round_id, "reason": state.end_reason, "winner_id": state.winner_id, "scores": scores}
	state.phase = "COMPLETED"
	_emit(events, "FINAL_SCORES", state.result)
