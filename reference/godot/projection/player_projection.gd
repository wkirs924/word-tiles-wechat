extends RefCounted
const Round = preload("res://core/round_reducer.gd")
const Session = preload("res://application/session_reducer.gd")
## Build allowlisted views; never remove a few fields from a copy of full state.

static func view(session: Dictionary, player_id: String) -> Dictionary:
	if player_id not in session.players:
		return {"ok": false, "error": "UNKNOWN_IDENTITY"}
	var result := {
		"ok": true, "schema_version": 1, "session_id": session.session_id,
		"revision": session.revision, "viewer_id": player_id,
		"players": session.players.duplicate(), "host_player_id": session.host_player_id,
		"config": session.config.duplicate(true), "round_number": session.round_counter,
		"history": session.history.duplicate(true), "ranking": Session.ranking(session), "round": null
	}
	if session.round == null:
		return result
	var state: Dictionary = session.round
	var counts: Dictionary = {}
	var rivers: Dictionary = {}
	for player in state.players:
		counts[player] = state.hands[player].size()
		rivers[player] = Round.tile_records(state, state.rivers[player])
	var pending: Variant = null
	if state.pending != null:
		pending = {
			"id": state.pending.id, "owner_id": state.pending.owner_id,
			"tile_ids": state.pending.tile_ids.duplicate(), "text": state.pending.text,
			"characters": state.pending.characters.duplicate(),
			"resource_keys": state.pending.resource_keys.duplicate(),
			"reading_choices": state.pending.reading_choices.duplicate(true),
			"votes_received": state.pending.votes.size(), "has_voted": state.pending.votes.has(player_id)
		}
	result.round = {
		"round_id": state.round_id, "phase": state.phase, "turn_id": state.turn_id,
		"dealer_id": state.players[int(state.dealer_seat)], "active_player_id": Round.active_player(state),
		"dice": state.setup.dice.duplicate(), "hand": Round.tile_records(state, state.hands[player_id]),
		"hand_counts": counts, "rivers": rivers, "wall_remaining": state.wall.size() - state.wall_cursor,
		"sentences": state.sentences.duplicate(true), "sentence_points": state.scores.duplicate(true),
		"pending_sentence": pending, "winner_id": state.winner_id, "end_reason": state.end_reason,
		"rating_bonus_thirds": state.rating_bonus_thirds.duplicate(true), "result": state.result.duplicate(true) if state.result != null else null
	}
	return result

static func events(authoritative_events: Array, player_id: String, players: Array) -> Array:
	if player_id not in players:
		return []
	var visible: Array = []
	for event in authoritative_events:
		var data: Dictionary = event.public.duplicate(true)
		data.merge(event.private.get(player_id, {}).duplicate(true), true)
		visible.append({"id": event.id, "revision": event.revision, "round_id": event.round_id, "type": event.type, "data": data})
	return visible

static func delivery(session: Dictionary, action_result: Dictionary, player_id: String) -> Dictionary:
	# Receipt routing is the host/controller's responsibility: only send the receipt
	# to the request's actor. Views and visible events may go to every player.
	return {"view": view(session, player_id), "events": events(action_result.events, player_id, session.players)}
