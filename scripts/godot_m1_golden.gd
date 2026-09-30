extends SceneTree
const Session = preload("res://application/session_reducer.gd")
const PlayerProjection = preload("res://projection/player_projection.gd")

func _initialize() -> void:
	var players := ["alice", "bob", "carol", "dave"]
	var tiles: Array = []
	var glyphs := ["天", "地", "人", "和", "风", "雨", "云", "山"]
	for i in range(53):
		tiles.append({"id": "tile_%03d" % i, "glyph": glyphs[i % 8], "syllable_key": "syllable_%d" % (i % 8), "base_tone": 1})
	var config := preload("res://core/rules.gd").defaults()
	config.tile_count = 53
	var created := Session.create("golden-session", players, "alice", config)
	if not created.ok:
		printerr("CREATE_FAILED: ", created.error)
		quit(1)
		return
	var state: Dictionary = created.state
	var commands: Array = []
	var steps: Array = []
	var start := {"command_id": "g1", "type": "START_NEXT_ROUND", "payload": {"round_id": "golden-round", "tiles": tiles, "seed": 42}}
	var x := Session.reduce(state, start, "alice")
	state = x.state
	commands.append({"actor": "alice", "command": start})
	steps.append(_step(state, x))
	var owner: String = state.round.players[state.round.active_seat]
	var proposal := {"command_id": "g2", "type": "PROPOSE_SENTENCE", "round_id": "golden-round", "turn_id": 1, "payload": {"tile_ids": state.round.hands[owner].duplicate(), "resource_keys": ["meme.c", "meme.a"]}}
	x = Session.reduce(state, proposal, owner)
	state = x.state
	commands.append({"actor": owner, "command": proposal})
	steps.append(_step(state, x))
	var voters: Array = []
	for p in players:
		if p != owner:
			voters.append(p)
	for i in range(3):
		var ballot := {"command_id": "g%d" % (i + 3), "type": "SUBMIT_VOTE", "round_id": "golden-round", "proposal_id": "golden-round:1", "payload": {"approve": i != 0, "rating": [3, 0, 2][i]}}
		x = Session.reduce(state, ballot, voters[i])
		state = x.state
		commands.append({"actor": voters[i], "command": ballot})
		steps.append(_step(state, x))
	var output := {"engine": Engine.get_version_info().string, "commands": commands, "steps": steps}
	print("GOLDEN_JSON:" + JSON.stringify(output))
	quit()

func _step(state: Dictionary, x: Dictionary) -> Dictionary:
	return {"receipt": x.receipt, "event_types": x.events.map(func(e): return e.type), "alice_view": PlayerProjection.view(state, "alice"), "alice_events": PlayerProjection.events(x.events, "alice", state.players)}
