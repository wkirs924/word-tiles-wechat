extends RefCounted
const Data = preload("res://core/json_data.gd")
const Rules = preload("res://core/rules.gd")
const Round = preload("res://core/round_reducer.gd")
## Sole application write boundary. trusted_player_id must come from a local controller
## or an authenticated transport binding, NEVER from a client command's actor field.
## The command ledger includes rejections; game revisions only advance on success.

static func create(session_id: String, players: Array, host_player_id: String, config: Dictionary = {}) -> Dictionary:
	if not Data.identifier(session_id) or not Data.is_json(players) or not Data.is_json(config):
		return {"ok": false, "error": "INVALID_SESSION"}
	var seen: Dictionary = {}
	for player in players:
		if not Data.identifier(player) or seen.has(player):
			return {"ok": false, "error": "INVALID_PLAYERS"}
		seen[player] = true
	if players.size() != 4 or host_player_id not in players:
		return {"ok": false, "error": "INVALID_PLAYERS"}
	var rules: Dictionary = Rules.defaults() if config.is_empty() else config.duplicate(true)
	var error := Rules.validate(rules)
	if not error.is_empty():
		return {"ok": false, "error": error}
	var totals: Dictionary = {}
	for player in players:
		totals[player] = 0
	var initial := {"session_id": session_id, "players": players.duplicate(), "host_player_id": host_player_id, "config": rules.duplicate(true)}
	return {"ok": true, "state": {
		"schema_version": 1, "initial": initial, "session_id": session_id,
		"players": players.duplicate(), "host_player_id": host_player_id, "config": rules,
		"revision": 0, "round_counter": 0, "round": null, "history": [],
		"totals_thirds": totals, "receipts": {}, "journal": []
	}}

static func reduce(previous: Dictionary, command: Variant, trusted_player_id: String) -> Dictionary:
	if trusted_player_id not in previous.players:
		return _uncached(previous, "UNKNOWN_IDENTITY")
	if not Data.is_json(command) or not command is Dictionary or not Data.identifier(command.get("command_id")):
		return _uncached(previous, "INVALID_COMMAND")
	var key := Data.canonical([trusted_player_id, command.command_id])
	var fingerprint := Data.canonical(command)
	if previous.receipts.has(key):
		var cached: Dictionary = previous.receipts[key]
		if cached.fingerprint != fingerprint:
			return _uncached(previous, "COMMAND_ID_REUSED")
		return {"state": previous.duplicate(true), "receipt": cached.receipt.duplicate(true), "events": [], "duplicate": true}
	var state := previous.duplicate(true)
	var outcome := _apply(state, command, trusted_player_id)
	var events: Array = []
	if outcome.ok:
		state.revision += 1
		events = outcome.events
		for index in range(events.size()):
			events[index]["id"] = state.session_id + ":" + str(int(state.revision)) + ":" + str(index)
			events[index]["revision"] = state.revision
			events[index]["round_id"] = state.round.round_id
	var receipt := {"command_id": command.command_id, "ok": outcome.ok, "error": outcome.get("error", ""), "revision": state.revision, "event_ids": []}
	for event in events:
		receipt.event_ids.append(event.id)
	state.receipts[key] = {"fingerprint": fingerprint, "receipt": receipt.duplicate(true)}
	state.journal.append({"actor": trusted_player_id, "command": command.duplicate(true), "receipt": receipt.duplicate(true)})
	return {"state": state, "receipt": receipt, "events": events, "duplicate": false}

static func ranking(state: Dictionary) -> Array:
	var order: Array = []
	# Stable equal-score order is display-only. Rank has no secondary tie breaker.
	# Dictionary/Array sort helpers do not promise a stable sort; insert ties after peers.
	for player in state.players:
		var position := 0
		while position < order.size() and state.totals_thirds[order[position]] >= state.totals_thirds[player]:
			position += 1
		order.insert(position, player)
	var result: Array = []
	var last_score: Variant = null
	var rank := 0
	for index in range(order.size()):
		var score := int(state.totals_thirds[order[index]])
		if last_score == null or score != last_score:
			rank = index + 1
		result.append({"player_id": order[index], "rank": rank, "total": {"numerator": score, "denominator": 3}})
		last_score = score
	return result

static func export_replay(state: Dictionary) -> Dictionary:
	return {"schema_version": 1, "initial": state.initial.duplicate(true), "journal": state.journal.duplicate(true)}

static func replay(record: Dictionary) -> Dictionary:
	if not Data.is_json(record) or record.get("schema_version") != 1 or not record.get("initial") is Dictionary or not record.get("journal") is Array:
		return {"ok": false, "error": "INVALID_REPLAY"}
	var initial: Dictionary = record.initial
	if not initial.get("session_id") is String or not initial.get("players") is Array or not initial.get("host_player_id") is String or not initial.get("config") is Dictionary:
		return {"ok": false, "error": "INVALID_REPLAY"}
	var created := create(initial.session_id, initial.players, initial.host_player_id, initial.config)
	if not created.ok:
		return created
	var state: Dictionary = created.state
	for entry in record.journal:
		if not entry is Dictionary or not entry.get("actor") is String or not entry.get("command") is Dictionary or not entry.get("receipt") is Dictionary:
			return {"ok": false, "error": "INVALID_REPLAY_ENTRY"}
		var step := reduce(state, entry.command, entry.actor)
		if Data.canonical(step.receipt) != Data.canonical(entry.receipt) or step.duplicate:
			return {"ok": false, "error": "REPLAY_MISMATCH"}
		state = step.state
	return {"ok": true, "state": state}

static func _uncached(state: Dictionary, error: String) -> Dictionary:
	return {"state": state.duplicate(true), "receipt": {"ok": false, "error": error, "revision": state.revision, "event_ids": []}, "events": [], "duplicate": false}

static func _apply(state: Dictionary, command: Dictionary, actor: String) -> Dictionary:
	if not Data.only_keys(command, ["command_id", "type", "payload", "round_id", "turn_id", "proposal_id"]) or not command.get("type") is String or not command.get("payload") is Dictionary:
		return {"ok": false, "error": "INVALID_COMMAND"}
	var host: bool = actor == state.host_player_id
	if command.type == "START_NEXT_ROUND":
		if not host:
			return {"ok": false, "error": "HOST_REQUIRED"}
		if state.round != null and state.round.phase not in ["COMPLETED", "ABORTED"]:
			return {"ok": false, "error": "ROUND_STILL_ACTIVE"}
		var payload: Dictionary = command.payload.duplicate(true)
		var extra: Variant = payload.get("allow_extra_round", false)
		if not extra is bool:
			return {"ok": false, "error": "INVALID_PAYLOAD"}
		payload.erase("allow_extra_round")
		var completed := 0
		for summary in state.history:
			if summary.round_id == payload.get("round_id"):
				return {"ok": false, "error": "ROUND_ID_REUSED"}
			if summary.settled:
				completed += 1
		if completed >= state.config.planned_rounds and not extra:
			return {"ok": false, "error": "PLANNED_ROUNDS_FINISHED"}
		var started := Round.start(state.players, state.config, payload)
		if not started.ok:
			return started
		state.round = started.state
		state.round_counter += 1
		return {"ok": true, "events": started.events}
	if state.round == null:
		return {"ok": false, "error": "NO_ACTIVE_ROUND"}
	var result := Round.reduce(state.round, command, actor, host)
	if not result.ok:
		return result
	state.round = result.state
	if state.round.phase in ["COMPLETED", "ABORTED"]:
		_record_round(state, result.events)
	return {"ok": true, "events": result.events}

static func _record_round(state: Dictionary, events: Array) -> void:
	var round_state: Dictionary = state.round
	var settled: bool = round_state.phase == "COMPLETED"
	var scores: Variant = null
	if settled:
		scores = round_state.result.scores.duplicate(true)
		for player in state.players:
			state.totals_thirds[player] += int(scores[player].total.numerator)
	var remaining: Dictionary = {}
	for player in state.players:
		remaining[player] = round_state.hands[player].size()
	var summary := {
		"round_number": state.round_counter, "round_id": round_state.round_id,
		"reason": round_state.end_reason, "winner_id": round_state.winner_id, "settled": settled,
		"scores": scores, "confirmed_sentence_points": round_state.scores.duplicate(true),
		"confirmed_rating_bonus_thirds": round_state.rating_bonus_thirds.duplicate(true),
		"remaining_tiles": remaining, "sentences": round_state.sentences.duplicate(true),
		"cumulative_totals_thirds": state.totals_thirds.duplicate(true)
	}
	state.history.append(summary)
	events.append({"type": "ROUND_RECORDED", "public": {"summary": summary.duplicate(true), "ranking": ranking(state)}, "private": {}})
