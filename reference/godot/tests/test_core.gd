extends RefCounted
const Session = preload("res://application/session_reducer.gd")
const Round = preload("res://core/round_reducer.gd")
const Rules = preload("res://core/rules.gd")
const Data = preload("res://core/json_data.gd")
const Setup = preload("res://core/round_setup.gd")
const PlayerView = preload("res://projection/player_projection.gd")
const Invariants = preload("res://core/invariants.gd")
const HostTests = preload("res://tests/test_host.gd")
const PLAYERS = ["alice", "bob", "carol", "dave"]
var checks := 0
var failures := 0
var serial := 0

func run() -> Dictionary:
	_check(_test_setup_and_config() == true, "Completed _test_setup_and_config")
	_check(_test_turn_validation() == true, "Completed _test_turn_validation")
	_check(_test_sentence_validation() == true, "Completed _test_sentence_validation")
	_check(_test_vote_matrix() == true, "Completed _test_vote_matrix")
	_check(_test_one_tile_can_win() == true, "Completed _test_one_tile_can_win")
	_check(_test_settlement_and_session() == true, "Completed _test_settlement_and_session")
	_check(_test_draw_and_empty_memes() == true, "Completed _test_draw_and_empty_memes")
	_check(_test_abort() == true, "Completed _test_abort")
	_check(_test_projection() == true, "Completed _test_projection")
	_check(_test_dedup_and_replay() == true, "Completed _test_dedup_and_replay")
	_check(_test_malformed_inputs() == true, "Completed _test_malformed_inputs")
	_check(_test_simulations() == true, "Completed _test_simulations")
	_check(_test_regressions() == true, "Completed _test_regressions")
	_check(_test_meme_sequence() == true, "Completed _test_meme_sequence")
	var host_errors := HostTests.run()
	_check(host_errors.is_empty(), "Host facade/reconnect: " + str(host_errors))
	return {"checks": checks, "failures": failures}

func _test_meme_sequence() -> bool:
	print("TEST inline images / atomic rating ballots / privacy / exact bonuses")
	var config := Rules.defaults()
	config.max_meme_images = 0
	_check(Rules.validate(config) == "INVALID_MEME_LIMIT", "zero image limit rejected")
	config.max_meme_images = 3
	var state := _started(config)
	var owner := Round.active_player(state.round)
	var ids: Array = state.round.hands[owner].slice(0, 2)
	for invalid in [null, "meme", [42], ["a", "a"], ["a", "b", "c", "d"], ["C:/image.png"]]:
		_reject(state, "PROPOSE_SENTENCE", {"tile_ids": ids, "resource_keys": invalid}, owner)
	var ordered := ["meme.c", "meme.a", "meme.b"]
	var command := _command(state, "PROPOSE_SENTENCE", {"tile_ids": ids, "resource_keys": ordered})
	var result := Session.reduce(state, command, owner)
	_check(result.receipt.ok and result.state.round.pending.resource_keys == ordered, "images preserve selection order")
	_check(result.events[0].public.resource_keys == ordered, "proposal event includes ordered images")
	state = result.state
	var retry := Session.reduce(state, command, owner)
	_check(retry.duplicate and retry.events.is_empty(), "proposal retry is idempotent")
	var voters: Array = PLAYERS.duplicate()
	voters.erase(owner)
	for invalid in [-1, 4, 1.5, true, "3", null]:
		_reject(state, "SUBMIT_VOTE", {"approve": true, "rating": invalid}, voters[0])
	_reject(state, "SUBMIT_VOTE", {"approve": true}, voters[0], "INVALID_PAYLOAD")
	_reject(state, "SUBMIT_VOTE", {"approve": true, "rating": 3}, owner, "SELF_VOTE_FORBIDDEN")
	for index in range(3):
		command = _command(state, "SUBMIT_VOTE", {"approve": index != 0, "rating": [3, 0, 2][index]})
		result = Session.reduce(state, command, voters[index])
		_check(result.receipt.ok, "atomic ballot accepted")
		state = result.state
		var retried := Session.reduce(state, command, voters[index])
		_check(retried.duplicate and retried.events.is_empty() and retried.state == state, "ballot retry never scores twice")
		for viewer in PLAYERS:
			var view := PlayerView.view(state, viewer)
			if index < 2:
				_check(view.round.pending_sentence.resource_keys == ordered, "every viewer receives image sequence")
				_check(not view.round.pending_sentence.has("votes") and not view.round.pending_sentence.has("rating_average"), "partial ballot details hidden")
				view.round.pending_sentence.resource_keys.reverse()
				_check(state.round.pending.resource_keys == ordered, "detached projection")
			for event in PlayerView.events(result.events, viewer, PLAYERS):
				if event.type == "VOTE_SUBMITTED":
					_check(not event.data.has("rating") and not event.data.has("approve") and not event.data.has("actor"), "vote event only contains progress")
	_check(state.round.rating_bonus_thirds[owner] == 5, "opposing vote score participates in accepted mean")
	_check(state.round.sentences[0].rating_average == {"numerator": 5, "denominator": 3}, "exact five thirds")
	_check(state.round.sentences[0].resource_keys == ordered and not state.round.sentences[0].has("votes"), "accepted record preserves media without individual ballots")
	var replay := Session.replay(JSON.parse_string(JSON.stringify(Session.export_replay(state))))
	_check(replay.ok and Data.canonical(replay.state) == Data.canonical(state), "inline image ballot replay identical")
	# A second sentence from the same owner adds its own mean, never averages all turns together.
	for index in range(3):
		state = _send(state, "DRAW_TILE")
		var player := Round.active_player(state.round)
		state = _send(state, "DISCARD_TILE", {"tile_id": state.round.hands[player][0]})
	state = _send(state, "DRAW_TILE")
	state = _propose(state, state.round.hands[owner].size(), ["meme.c"])
	for voter in voters:
		state = _send(state, "SUBMIT_VOTE", {"approve": true, "rating": 1}, voter)
	_check(state.round.phase == "COMPLETED" and state.round.rating_bonus_thirds[owner] == 8, "per-sentence means accumulate and win settles immediately")
	_check(state.round.result.scores[owner].total.numerator == 3 * state.round.scores[owner] + 8, "final score includes accumulated means exactly")
	var rejected := _propose(_started(), 2, ["meme.c"])
	var rejected_owner: String = rejected.round.pending.owner_id
	for voter in PLAYERS:
		if voter != rejected_owner:
			rejected = _send(rejected, "SUBMIT_VOTE", {"approve": false, "rating": 3}, voter)
	_check(rejected.round.rating_bonus_thirds[rejected_owner] == 0 and rejected.round.scores[rejected_owner] == 0, "rejected sentence awards nothing")
	var plain := _propose(_started(), 2)
	var plain_voter: String = PLAYERS[(PLAYERS.find(plain.round.pending.owner_id) + 1) % 4]
	_reject(plain, "SUBMIT_VOTE", {"approve": true, "rating": 3}, plain_voter, "RATING_REQUIRES_MEME")
	plain = _approve(plain, 3)
	_check(plain.round.sentences[0].rating_average.numerator == 0, "no images never receive bonus points")
	var legacy := Rules.defaults()
	legacy.rules_version = "word-tiles-3"
	_check(not Session.create("old", PLAYERS, PLAYERS[0], legacy).ok, "old rules are not silently reinterpreted")
	_reject(_started(), "SUBMIT_MEME", {}, owner, "UNKNOWN_ACTION")
	_reject(_started(), "SUBMIT_RATING", {}, owner, "UNKNOWN_ACTION")
	return true

func _test_regressions() -> bool:
	print("TEST audit regressions: identifiers/numbers/event isolation/final tile/concurrency")
	var minimum_integer := -9223372036854775807 - 1
	_check(not Data.is_json(minimum_integer), "INT64_MIN must not overflow JSON-safe range validation")
	_check(Data.canonical(1.00000000000001) != Data.canonical(1.00000000000002), "Command fingerprints preserve distinct fractional values")
	var state := _send(_new(), "START_NEXT_ROUND", _setup("r".repeat(128)))
	state = _approve(_propose(state, 2))
	var owner: String = state.round.sentences[0].owner_id
	var aborted := Session.reduce(state, _command(state, "END_GAME"), "alice")
	var snapshot := Data.canonical(aborted.state)
	aborted.events.back().public.summary.confirmed_sentence_points[owner] = -999
	_check(Data.canonical(aborted.state) == snapshot, "Mutating returned events must not mutate authoritative history")
	# A small configured deck makes the final draw branch explicit and reachable.
	var config := Rules.defaults()
	config.tile_count = 54
	state = _started(config)
	owner = Round.active_player(state.round)
	state = _send(state, "DISCARD_TILE", {"tile_id": state.round.hands[owner][0]})
	state = _send(state, "DRAW_TILE")
	_check(state.round.wall_cursor == state.round.wall.size(), "Last physical tile drawn")
	state = _propose(state, 14)
	owner = state.round.pending.owner_id
	var queued: Array = []
	for player in PLAYERS:
		if player != owner:
			queued.append({"actor": player, "command": _command(state, "SUBMIT_VOTE", {"approve": true, "rating": 0})})
	var all_events: Array = []
	for request in queued:
		var result := Session.reduce(state, request.command, request.actor)
		_check(result.receipt.ok, "Concurrent ballots based on same proposal are all accepted")
		state = result.state
		all_events.append_array(result.events)
	_check(state.round.winner_id == owner and state.round.end_reason == "WIN", "Final tile winning sentence takes precedence over draw settlement")
	var won_events := 0
	for event in all_events:
		if event.type == "PLAYER_WON":
			won_events += 1
	_check(won_events == 1, "Exactly one win event")
	var retried := Session.reduce(state, queued.back().command, queued.back().actor)
	_check(retried["duplicate"] and retried.events.is_empty() and retried.state.round.scores == state.round.scores, "Final vote retry cannot repeat points/win")
	var parsed: Dictionary = JSON.parse_string(JSON.stringify(state))
	_check(Data.canonical(PlayerView.view(parsed, owner)) == Data.canonical(PlayerView.view(state, owner)), "Reconnect projection stable after JSON serialization")
	return true

func _check(condition: bool, message: String) -> void:
	checks += 1
	if not condition:
		failures += 1
		push_error("FAIL: " + message)

func _tiles(count: int = 136) -> Array:
	var result: Array = []
	var glyphs := ["天", "地", "人", "和", "风", "雨", "云", "山"]
	for index in range(count):
		result.append({"id": "tile_%03d" % index, "glyph": glyphs[index % glyphs.size()], "syllable_key": "syllable_%d" % (index % glyphs.size()), "base_tone": 1})
	return result

func _setup(round_id: String = "r1", seed_value: int = 42, count: int = 136) -> Dictionary:
	return {"round_id": round_id, "tiles": _tiles(count), "seed": seed_value}

func _new(config: Dictionary = {}) -> Dictionary:
	var created := Session.create("session", PLAYERS, "alice", config)
	_check(created.ok, "Session creation")
	return created.state

func _command(state: Dictionary, kind: String, payload: Dictionary = {}) -> Dictionary:
	serial += 1
	var command := {"command_id": "cmd_%d" % serial, "type": kind, "payload": payload}
	if state.round != null:
		command["round_id"] = state.round.round_id
		command["turn_id"] = state.round.turn_id
		if state.round.pending != null:
			command["proposal_id"] = state.round.pending.id
	return command

func _send(state: Dictionary, kind: String, payload: Dictionary = {}, actor: String = "") -> Dictionary:
	if actor.is_empty():
		actor = "alice" if state.round == null or kind in ["START_NEXT_ROUND", "END_GAME"] else Round.active_player(state.round)
	var before := Data.canonical(state)
	var result := Session.reduce(state, _command(state, kind, payload), actor)
	_check(result.receipt.ok, "%s succeeded: %s" % [kind, result.receipt.error])
	_check(Data.canonical(state) == before, "Reducer input is immutable")
	if result.state.round != null:
		_check(Invariants.check(result.state.round).is_empty(), "Round invariants after " + kind)
	_check(Data.is_json(result.state), "Session is JSON-safe")
	return result.state

func _started(config: Dictionary = {}) -> Dictionary:
	var state := _new(config)
	return _send(state, "START_NEXT_ROUND", _setup("r1", 42, int(state.config.tile_count)))

func _reject(state: Dictionary, kind: String, payload: Dictionary, actor: String, expected: String = "") -> void:
	var result := Session.reduce(state, _command(state, kind, payload), actor)
	_check(not result.receipt.ok, kind + " should fail")
	if not expected.is_empty():
		_check(result.receipt.error == expected, "Expected %s, got %s" % [expected, result.receipt.error])
	_check(Data.canonical(state.round) == Data.canonical(result.state.round), "Rejected action leaves round unchanged")
	_check(result.events.is_empty() and result.state.revision == state.revision, "Rejected action has no events/revision")

func _approve(state: Dictionary, yes_count: int = 3) -> Dictionary:
	var owner: String = state.round.pending.owner_id
	var index := 0
	for player in PLAYERS:
		if player != owner:
			state = _send(state, "SUBMIT_VOTE", {"approve": index < yes_count, "rating": 0}, player)
			index += 1
	return state

func _propose(state: Dictionary, count: int, images: Array = []) -> Dictionary:
	var owner := Round.active_player(state.round)
	return _send(state, "PROPOSE_SENTENCE", {"tile_ids": state.round.hands[owner].slice(0, count), "resource_keys": images})

func _win(state: Dictionary) -> Dictionary:
	var player := Round.active_player(state.round)
	state = _propose(state, state.round.hands[player].size())
	return _approve(state, 2)

func _test_setup_and_config() -> bool:
	print("TEST setup/config/determinism")
	var state := _started()
	var dealer := Round.active_player(state.round)
	_check(state.round.hands[dealer].size() == 14, "Dealer starts with 14")
	for player in PLAYERS:
		if player != dealer:
			_check(state.round.hands[player].size() == 13, "Other players start with 13")
	_check(state.round.wall.size() - state.round.wall_cursor == 83, "83 tiles left")
	_check(state.round.phase == "AWAIT_ACTION", "Dealer must not draw")
	var first := Setup.build(Rules.defaults(), _setup())
	var second := Setup.build(Rules.defaults(), _setup())
	_check(first == second, "Same seed, same wall and dice")
	_check(first.wall != Setup.build(Rules.defaults(), _setup("r2", 43)).wall, "Different seed changes shuffle")
	var explicit := _setup()
	explicit.erase("seed")
	explicit["wall"] = first.wall
	explicit["dice"] = first.setup.dice
	_check(Setup.build(Rules.defaults(), explicit).wall == first.wall, "Explicit wall accepted")
	explicit["wall"] = explicit.wall.duplicate()
	explicit.wall[0] = explicit.wall[1]
	_check(not Setup.build(Rules.defaults(), explicit).ok, "Duplicate wall tile rejected")
	var config := Rules.defaults()
	config.sentence_bonuses[1].min = 3
	_check(not Session.create("s", PLAYERS, "alice", config).ok, "Overlapping reward bands rejected")
	_check(not Session.create("s", ["a", "a", "b", "c"], "a").ok, "Duplicate players rejected")
	for count in [2, 3, 4, 5, 6, 14]:
		var expected: int = count + (0 if count <= 3 else (1 if count <= 5 else 3))
		_check(Rules.sentence_score(Rules.defaults(), count).total == expected, "Reward boundary %d" % count)
	return true

func _test_turn_validation() -> bool:
	print("TEST turn/discard/stale action")
	var state := _started()
	var dealer := Round.active_player(state.round)
	var next_player: String = state.players[(int(state.round.active_seat) + 1) % 4]
	_reject(state, "DRAW_TILE", {}, dealer, "WRONG_PHASE")
	_reject(state, "DISCARD_TILE", {"tile_id": state.round.hands[next_player][0]}, next_player, "NOT_YOUR_TURN")
	_reject(state, "DISCARD_TILE", {"tile_id": state.round.hands[next_player][0]}, dealer, "TILE_NOT_OWNED")
	var stale := _command(state, "DISCARD_TILE", {"tile_id": state.round.hands[dealer][1]})
	state = _send(state, "DISCARD_TILE", {"tile_id": state.round.hands[dealer][0]})
	_check(Round.active_player(state.round) == next_player and state.round.phase == "AWAIT_DRAW", "Seat rotates modulo four")
	_check(state.round.scores[dealer] == 0, "Discard is worth zero")
	_check(Session.reduce(state, stale, dealer).receipt.error == "STALE_TURN", "Stale turn rejected")
	_reject(state, "DISCARD_TILE", {"tile_id": state.round.hands[next_player][0]}, next_player, "WRONG_PHASE")
	state = _send(state, "DRAW_TILE", {}, "alice")
	_check(state.round.hands[next_player].size() == 14, "Host can trigger active player's draw")
	_reject(state, "DRAW_TILE", {}, next_player, "WRONG_PHASE")
	return true

func _test_sentence_validation() -> bool:
	print("TEST sentence ownership/readings")
	var state := _started()
	var actor := Round.active_player(state.round)
	var ids: Array = state.round.hands[actor]
	_reject(state, "PROPOSE_SENTENCE", {"tile_ids": [ids[0]]}, actor, "INVALID_SENTENCE_SIZE")
	_reject(state, "PROPOSE_SENTENCE", {"tile_ids": [ids[0], ids[0]]}, actor, "INVALID_SENTENCE_TILES")
	_reject(state, "PROPOSE_SENTENCE", {"tile_ids": [ids[0], "absent"]}, actor, "INVALID_SENTENCE_TILES")
	_reject(state, "PROPOSE_SENTENCE", {"tile_ids": ids.slice(0, 2), "reading_choices": [{"tone": 5}, null]}, actor, "INVALID_READINGS")
	_reject(state, "PROPOSE_SENTENCE", {"tile_ids": ids.slice(0, 2), "reading_choices": [{"tone": 1, "syllable_key": "replace"}, null]}, actor, "INVALID_READINGS")
	var reverse_ids := [ids[1], ids[0]]
	state = _send(state, "PROPOSE_SENTENCE", {"tile_ids": reverse_ids, "reading_choices": [{"tone": 2}, null]})
	_check(state.round.hands[actor].size() == 14, "Pending cards stay in hand")
	_check(state.round.pending.text == state.round.catalog[ids[1]].glyph + state.round.catalog[ids[0]].glyph, "Submitted order defines text")
	_reject(state, "SUBMIT_VOTE", {"approve": true, "rating": 0}, actor, "SELF_VOTE_FORBIDDEN")
	state = _approve(state)
	_check(state.round.sentences[0].reading_choices == [{"tone": 2}, null], "Tone choices preserved")
	_check(state.round.hands[actor].size() == 12 and state.round.scores[actor] == 2, "Two-card sentence accepted")
	return true

func _test_vote_matrix() -> bool:
	print("TEST every three-person yes/no combination")
	for mask in range(8):
		var state := _started()
		var owner := Round.active_player(state.round)
		state = _propose(state, 3)
		var index := 0
		var yes := 0
		for voter in PLAYERS:
			if voter == owner:
				continue
			var approve: bool = (mask & (1 << index)) != 0
			yes += 1 if approve else 0
			state = _send(state, "SUBMIT_VOTE", {"approve": approve, "rating": 0}, voter)
			if index < 2:
				_check(state.round.phase == "AWAIT_VOTES", "Wait for all three votes")
				_reject(state, "SUBMIT_VOTE", {"approve": true, "rating": 0}, voter, "ALREADY_VOTED")
			index += 1
		if yes >= 2:
			_check(state.round.scores[owner] == 3 and state.round.hands[owner].size() == 11, "Majority accepts")
		else:
			_check(state.round.scores[owner] == 0 and state.round.hands[owner].size() == 14, "Rejected cards unchanged")
			_reject(state, "PROPOSE_SENTENCE", {"tile_ids": state.round.hands[owner].slice(0, 2)}, owner, "WRONG_PHASE")
			_reject(state, "DRAW_TILE", {}, owner, "WRONG_PHASE")
			state = _send(state, "DISCARD_TILE", {"tile_id": state.round.hands[owner][0]})
			_check(state.round.hands[owner].size() == 13, "Exactly one forced discard")
	return true

func _test_one_tile_can_win() -> bool:
	print("TEST one remaining tile draws into winning two-character sentence")
	var state := _started()
	var dealer := Round.active_player(state.round)
	state = _approve(_propose(state, 13))
	_check(state.round.hands[dealer].size() == 1, "One tile remains")
	for index in range(3):
		state = _send(state, "DRAW_TILE")
		var player := Round.active_player(state.round)
		state = _send(state, "DISCARD_TILE", {"tile_id": state.round.hands[player][0]})
	state = _send(state, "DRAW_TILE")
	_check(Round.active_player(state.round) == dealer and state.round.hands[dealer].size() == 2, "One becomes two after draw")
	state = _win(state)
	_check(state.round.winner_id == dealer and state.round.scores[dealer] == 18, "Two-character final hand wins; bonuses sum correctly")
	_check(state.round.phase == "COMPLETED", "Win settles in the final ballot command")
	return true

func _test_settlement_and_session() -> bool:
	print("TEST settlement/rational totals/multiple rounds")
	var config := Rules.defaults()
	config.planned_rounds = 1
	var state := _started(config)
	var winner := Round.active_player(state.round)
	var other: String = PLAYERS[(PLAYERS.find(winner) + 1) % 4]
	state = _propose(state, state.round.hands[winner].size(), ["meme.score"])
	var index := 0
	for voter in PLAYERS:
		if voter != winner:
			state = _send(state, "SUBMIT_VOTE", {"approve": true, "rating": [1, 2, 3][index]}, voter)
			index += 1
	_check(state.round.phase == "COMPLETED" and state.history.size() == 1, "Finalized exactly once")
	_check(state.round.result.scores[winner].total.numerator == 57, "17 + 6/3 stored exactly as 57/3")
	_check(state.totals_thirds[winner] == 57, "Session total exact")
	_check(state.round.result.scores[other].rating_bonus.numerator == 0 and state.totals_thirds[other] == -39, "No accepted sentence means zero meme points, hand penalty retained")
	var ranked := Session.ranking(state)
	_check(ranked[0].rank == 1 and ranked[1].rank == 2 and ranked[2].rank == 2 and ranked[3].rank == 2, "Equal scores share rank")
	_reject(state, "END_GAME", {}, "alice", "ROUND_TERMINAL")
	_reject(state, "START_NEXT_ROUND", _setup("r2", 57), "alice", "PLANNED_ROUNDS_FINISHED")
	var payload := _setup("r2", 57)
	payload["allow_extra_round"] = true
	state = _send(state, "START_NEXT_ROUND", payload)
	_check(state.round.sentences.is_empty() and state.round.wall_cursor == 53 and state.round_counter == 2, "Fresh next round with same full tile count")
	_check(state.totals_thirds[winner] == 57, "Next round retains session total")
	state = _win(state)
	_check(state.history.size() == 2, "Second round recorded")
	for player in PLAYERS:
		_check(state.totals_thirds[player] == state.history[0].scores[player].total.numerator + state.history[1].scores[player].total.numerator, "Totals sum both completed rounds")
	return true

func _test_draw_and_empty_memes() -> bool:
	print("TEST final draw remains playable / wall exhaustion settlement")
	var state := _started()
	while state.round.phase not in ["COMPLETED"] and state.revision < 200 and failures == 0:
		if state.round.phase == "AWAIT_DRAW":
			var was_last: bool = state.round.wall_cursor == state.round.wall.size() - 1
			state = _send(state, "DRAW_TILE")
			if was_last:
				_check(state.round.phase == "AWAIT_ACTION", "Final tile does not interrupt action")
		else:
			var player := Round.active_player(state.round)
			state = _send(state, "DISCARD_TILE", {"tile_id": state.round.hands[player][0]})
	_check(state.round.end_reason == "WALL_EXHAUSTED" and state.round.winner_id == null, "Wall empty on required draw causes draw game")
	_check(state.round.phase == "COMPLETED", "No meme candidates: settle directly")
	for player in PLAYERS:
		_check(state.totals_thirds[player] == -39, "Draw still deducts all remaining cards")
	# Minimal wall with a legal accepted sentence, then draw settlement must complete directly.
	var config := Rules.defaults()
	config.tile_count = 53
	state = _approve(_propose(_started(config), 2))
	state = _send(state, "DRAW_TILE")
	_check(state.round.phase == "COMPLETED" and state.round.end_reason == "WALL_EXHAUSTED", "Draw settles directly even with accepted sentences")
	_check(state.round.phase == "COMPLETED", "Draw result exists")
	return true

func _test_abort() -> bool:
	print("TEST END_GAME every live phase / no rollback of committed draws")
	var start := _started()
	var owner := Round.active_player(start.round)
	var phases: Array = [start]
	var discarded := _send(start, "DISCARD_TILE", {"tile_id": start.round.hands[owner][0]})
	phases.append(discarded)
	phases.append(_send(discarded, "DRAW_TILE"))
	var proposed := _propose(start, 3)
	phases.append(proposed)
	var rejected := _approve(proposed, 0)
	phases.append(rejected)
	var voter: String = PLAYERS[(PLAYERS.find(owner) + 1) % 4]
	phases.append(_send(proposed, "SUBMIT_VOTE", {"approve": true, "rating": 0}, voter))
	phases.append(_approve(_propose(start, 2)))
	for sample in phases:
		var before := Data.canonical([sample.round.hands, sample.round.wall_cursor, sample.round.rivers, sample.round.sentences, sample.round.scores])
		var aborted := _send(sample, "END_GAME")
		_check(aborted.round.phase == "ABORTED" and aborted.round.pending == null, "Abort cancels pending work")
		_check(before == Data.canonical([aborted.round.hands, aborted.round.wall_cursor, aborted.round.rivers, aborted.round.sentences, aborted.round.scores]), "Abort neither moves cards nor changes confirmed points")
		_check(aborted.round.result == null and not aborted.history[0].settled, "No fabricated final result")
		for player in PLAYERS:
			_check(aborted.totals_thirds[player] == 0, "Aborted round not accumulated")
		_check(aborted.round.winner_id == sample.round.winner_id, "Abort never invents or removes confirmed winner")
		var next := _send(aborted, "START_NEXT_ROUND", _setup("r2", 41))
		_check(next.round.phase == "AWAIT_ACTION", "Next round allowed after abort")
	_reject(start, "END_GAME", {}, "bob", "HOST_REQUIRED")
	return true

func _test_projection() -> bool:
	print("TEST state + event privacy and detached projection copies")
	var empty := _new()
	var started := Session.reduce(empty, _command(empty, "START_NEXT_ROUND", _setup()), "alice")
	var state: Dictionary = started.state
	for viewer in PLAYERS:
		var view := PlayerView.view(state, viewer)
		var serialized := Data.canonical(view)
		_check(not view.round.has("wall") and not view.round.has("catalog") and not view.has("journal") and not view.round.has("setup"), "No full state secrets in view")
		var visible_events := Data.canonical(PlayerView.events(started.events, viewer, PLAYERS))
		for owner in PLAYERS:
			if owner != viewer:
				for id in state.round.hands[owner]:
					_check(not serialized.contains('"' + id + '"') and not visible_events.contains('"' + id + '"'), "Other hand ID absent from state and deal events")
		view.round.hand.clear()
		_check(not state.round.hands[viewer].is_empty(), "Projection changes do not mutate authority")
	var actor := Round.active_player(state.round)
	state = _send(state, "DISCARD_TILE", {"tile_id": state.round.hands[actor][0]})
	actor = Round.active_player(state.round)
	var draw := Session.reduce(state, _command(state, "DRAW_TILE"), actor)
	var draw_tile: String = draw.state.round.hands[actor].back()
	for viewer in PLAYERS:
		var text := Data.canonical(PlayerView.events(draw.events, viewer, PLAYERS))
		_check(text.contains('"' + draw_tile + '"') == (viewer == actor), "Draw event reveals tile only to drawer")
	state = _propose(draw.state, 2)
	var voter: String = PLAYERS[(PLAYERS.find(actor) + 1) % 4]
	state = _send(state, "SUBMIT_VOTE", {"approve": false, "rating": 0}, voter)
	for viewer in PLAYERS:
		var view := PlayerView.view(state, viewer)
		_check(view.round.pending_sentence.votes_received == 1 and not view.round.pending_sentence.has("votes"), "Pending sentence public, individual ballot private")
	_check(not PlayerView.view(state, "stranger").ok, "Unknown viewer rejected")
	_check(PlayerView.events(draw.events, "stranger", PLAYERS).is_empty(), "Unknown viewer sees no events")
	return true

func _test_dedup_and_replay() -> bool:
	print("TEST dedup successes + failures / JSON roundtrip / replay")
	var state := _started()
	var actor := Round.active_player(state.round)
	var command := _command(state, "PROPOSE_SENTENCE", {"tile_ids": state.round.hands[actor].duplicate()})
	var first := Session.reduce(state, command, actor)
	var again := Session.reduce(first.state, command, actor)
	_check(again["duplicate"] and again.events.is_empty() and again.receipt == first.receipt, "Duplicate returns original receipt, emits nothing")
	_check(Data.canonical(first.state) == Data.canonical(again.state), "Duplicate does not advance ledger/revision/game")
	var changed := command.duplicate(true)
	changed.payload.tile_ids.pop_back()
	_check(Session.reduce(first.state, changed, actor).receipt.error == "COMMAND_ID_REUSED", "Same ID, different payload rejected")
	state = _approve(first.state)
	again = Session.reduce(state, command, actor)
	_check(again.receipt == first.receipt and again.events.is_empty(), "Old receipt survives later phases")
	_check(again.state.totals_thirds == state.totals_thirds, "Retry cannot repeat cumulative scoring")
	var rejected_command := _command(state, "DRAW_TILE")
	var failure := Session.reduce(state, rejected_command, actor)
	var retried_failure := Session.reduce(failure.state, rejected_command, actor)
	_check(not failure.receipt.ok and failure.receipt == retried_failure.receipt and retried_failure["duplicate"], "Rejected commands also deduplicate")
	state = failure.state
	var parsed: Dictionary = JSON.parse_string(JSON.stringify(state))
	_check(Data.canonical(parsed) == Data.canonical(state), "JSON roundtrip equivalent including numeric normalization")
	var replay_record: Dictionary = JSON.parse_string(JSON.stringify(Session.export_replay(state)))
	var replayed := Session.replay(replay_record)
	_check(replayed.ok, "Replay succeeds")
	if replayed.ok:
		_check(Data.canonical(replayed.state) == Data.canonical(state), "Replay produces identical full state/ledger/history")
	var next_a := Session.reduce(state, _command(state, "START_NEXT_ROUND", _setup("r2", 77)), "alice")
	var last_command: Dictionary = next_a.state.journal.back().command
	var next_b := Session.reduce(parsed, last_command, "alice")
	_check(Data.canonical(next_a.state) == Data.canonical(next_b.state), "JSON-restored data accepts commands identically")
	replay_record.journal[0].receipt.revision = 999
	_check(not Session.replay(replay_record).ok, "Replay receipt tampering detected")
	return true

func _test_malformed_inputs() -> bool:
	print("TEST malformed/untrusted commands")
	var state := _started()
	var actor := Round.active_player(state.round)
	for malformed in [null, [], "DRAW_TILE", 12, {}, {"command_id": "x", "type": []}, {"command_id": "x", "type": "DRAW_TILE", "payload": null}]:
		var result := Session.reduce(state, malformed, actor)
		_check(not result.receipt.ok and result.events.is_empty(), "Malformed command safely rejected")
	var spoof := _command(state, "END_GAME")
	spoof.actor_id = "alice"
	spoof.is_host = true
	_check(not Session.reduce(state, spoof, "bob").receipt.ok, "Self-reported identity never accepted")
	_check(Session.reduce(state, _command(state, "END_GAME"), "stranger").receipt.error == "UNKNOWN_IDENTITY", "Transport identity must be participant")
	var wrong_round := _command(state, "DISCARD_TILE", {"tile_id": state.round.hands[actor][0]})
	wrong_round.round_id = "old"
	_check(Session.reduce(state, wrong_round, actor).receipt.error == "STALE_ROUND", "Stale round rejected")
	_reject(state, "PLAYER_WON", {}, actor, "UNKNOWN_ACTION")
	_reject(state, "PROPOSE_SENTENCE", {"tile_ids": [null, {}]}, actor, "INVALID_SENTENCE_TILES")
	return true

func _test_simulations() -> bool:
	print("TEST deterministic full-game simulations with invariant checks")
	for seed_value in range(1, 7):
		var state := _send(_new(), "START_NEXT_ROUND", _setup("r1", seed_value))
		var steps := 0
		while state.round.phase not in ["COMPLETED"] and steps < 350:
			steps += 1
			var actor := Round.active_player(state.round)
			match state.round.phase:
				"AWAIT_DRAW": state = _send(state, "DRAW_TILE")
				"AWAIT_ACTION":
					if (steps + seed_value) % 3 == 0:
						var count: int = mini(state.round.hands[actor].size(), 2 + (steps % 6))
						state = _propose(state, count)
					else:
						state = _send(state, "DISCARD_TILE", {"tile_id": state.round.hands[actor][0]})
				"AWAIT_VOTES": state = _approve(state, 1 if steps % 4 == 0 else 2)
				"MUST_DISCARD": state = _send(state, "DISCARD_TILE", {"tile_id": state.round.hands[actor][0]})
		_check(steps < 350, "Simulation terminates")
		_check(state.round.phase == "COMPLETED", "Simulation fully settled")
		var replayed := Session.replay(Session.export_replay(state))
		_check(replayed.ok and Data.canonical(replayed.state) == Data.canonical(state), "Simulation replay matches")
	return true


