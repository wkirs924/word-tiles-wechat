extends RefCounted
const Table = preload("res://application/local_table.gd")
var failures := 0
var checks := 0
var serial := 0

func check(value: bool, message: String) -> void:
	checks += 1
	if not value:
		failures += 1
		push_error("FAIL: M2 " + message)

func seat(table: RefCounted, player: String) -> Dictionary:
	var covered: Dictionary = table.begin_handoff(player)
	check(covered.ok and covered.view == null and covered.events.is_empty(), "handoff hides previous view")
	check(table.current().view == null, "no view before confirmation")
	check(not table.submit({}).ok, "cannot submit during handoff")
	var packet: Dictionary = table.confirm_handoff()
	check(packet.view.viewer_id == player, "confirmed seat receives only its view")
	return packet.view

func send(table: RefCounted, kind: String, payload: Dictionary = {}) -> Dictionary:
	serial += 1
	var view: Dictionary = table.current().view
	var command := {"command_id": "m2_" + str(serial), "type": kind, "payload": payload}
	if view.round != null:
		command["round_id"] = view.round.round_id
		command["turn_id"] = view.round.turn_id
		if view.round.pending_sentence != null:
			command["proposal_id"] = view.round.pending_sentence.id
	var packet: Dictionary = table.submit(command)
	check(packet.ok, "accepted " + kind)
	check(not packet.has("deliveries") and not packet.has("state"), "UI never receives host routing map/state")
	return packet

func run() -> bool:
	print("TEST M2 hot-seat handoff/voting/ratings/next round")
	var table := Table.new()
	var players := ["a", "b", "c", "d"]
	check(table.initialize("m2", players, "a").ok, "initialize")
	check(table.current().view == null, "starts covered")
	seat(table, "a")
	var tiles: Array = []
	var wall: Array = []
	for index in range(136):
		var id := "t" + str(index)
		tiles.append({"id": id, "glyph": "字"})
		wall.append(id)
	# Dice sum five selects seat a, making the integration scenario explicit.
	var setup := {"round_id": "r1", "tiles": tiles, "wall": wall, "dice": [2, 3]}
	var started := send(table, "START_NEXT_ROUND", setup)
	check(started.view.round.hand.size() == 14, "dealer sees own hand")
	var ids: Array = []
	for tile in started.view.round.hand:
		ids.append(tile.id)
	send(table, "PROPOSE_SENTENCE", {"tile_ids": ids, "resource_keys": ["test.b", "test.a"]})
	for voter in ["b", "c", "d"]:
		var view := seat(table, voter)
		check(view.round.hand.size() == 13, "voter sees own hand")
		check(not view.round.pending_sentence.has("votes"), "individual ballots hidden")
		send(table, "SUBMIT_VOTE", {"approve": true, "rating": 3})
	var winner_view := seat(table, "a")
	check(winner_view.round.winner_id == "a", "win survived three handoffs")
	var completed: Dictionary = table.current().view
	check(completed.round.phase == "COMPLETED" and completed.history.size() == 1, "settled after rating handoffs")
	check(completed.ranking[0].total.numerator == 60, "17 sentence points plus three rating points")
	# A non-host seat cannot spoof the host by adding actor fields.
	var spoof := {"command_id": "spoof", "type": "START_NEXT_ROUND", "payload": setup, "actor_id": "a"}
	check(not table.submit(spoof).ok, "reject self-reported identity")
	seat(table, "a")
	setup.round_id = "r2"
	var next := send(table, "START_NEXT_ROUND", setup)
	check(next.view.round_number == 2 and next.view.history.size() == 1, "next round retains history")
	check(next.view.round.hand.size() == 14 and next.view.round.sentences.is_empty(), "fresh round after handoff")
	check(table.cover().view == null, "manual cover clears seat")
	check(not table.confirm_handoff().ok, "cover cancels pending handoff")
	seat(table, "b")
	check(not table.begin_handoff("unknown").ok and table.current().view == null, "invalid seat fails closed")
	seat(table, "a")
	send(table, "END_GAME")
	check(table.current().view.round.phase == "ABORTED", "host can end after reconnecting seat")
	return true
