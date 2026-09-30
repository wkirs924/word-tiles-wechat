extends RefCounted
## The single presentation intent controller. Caches only this seat's projection.
## Views receive detached snapshots; rule validation stays in the authoritative core.
signal changed
signal composer_reset
signal feedback(result: Dictionary)
signal notice(message: String)
const LocalTable = preload("res://application/local_table.gd")
const Content = preload("res://presentation/content_store.gd")
const PLAYERS := ["东", "南", "西", "北"]
var _content: Content
var _table: RefCounted
var _view: Dictionary = {}
var _selected: Array = []
var _meme_keys: Array = []
var _meme_expanded := false
var _ballot_choice: Variant = null
var _drawn_tile := ""
var _pending_seat := ""
var _handoff_allowed := false
var _screen := "MENU"
var _seed := 42
var _deck_preset := ""
var _serial := 0
var _session_serial := 0

func _init(content: Content) -> void:
	_content = content

func screen_state() -> Dictionary:
	return {"screen": _screen, "seed": _seed, "deck_preset": _deck_preset,
		"pending_seat": _pending_seat, "handoff_allowed": _handoff_allowed}

func draft() -> Dictionary:
	return {"tile_ids": _selected.duplicate(), "meme_keys": _meme_keys.duplicate(),
		"meme_expanded": _meme_expanded, "ballot_choice": _ballot_choice, "drawn_tile": _drawn_tile}

func set_deck_preset(key: String) -> void:
	_deck_preset = key

func show_menu() -> void:
	_view = {}
	_table = null
	_pending_seat = ""
	_handoff_allowed = false
	_screen = "MENU"
	_clear_draft()
	changed.emit()

func _clear_draft() -> void:
	_selected.clear()
	_meme_keys.clear()
	_meme_expanded = false
	_ballot_choice = null
	_drawn_tile = ""
	composer_reset.emit()

func start_game(seed_value: int) -> void:
	_seed = seed_value
	if _content.tiles(_deck_preset).is_empty():
		notice.emit(_content.text("invalid_deck"))
		return
	_session_serial += 1
	_table = LocalTable.new()
	_table.initialize("local-" + str(_session_serial), PLAYERS, "东")
	choose_seat("东")

func choose_seat(player: String) -> void:
	if _table == null: return
	_view = {}
	_clear_draft()
	_pending_seat = player
	var packet: Dictionary = _table.begin_handoff(player)
	_handoff_allowed = packet.ok
	_screen = "HANDOFF"
	changed.emit()

func accept_handoff() -> void:
	if _table == null: return
	var packet: Dictionary = _table.confirm_handoff()
	if packet.get("view") != null:
		_view = packet.view.duplicate(true)
		_screen = "PLAYER"
		changed.emit()

func current_view() -> Dictionary:
	return _view.duplicate(true)

func selected_tiles() -> Array:
	return _selected.duplicate()

func dispatch(kind: String, payload: Dictionary = {}) -> Dictionary:
	if _view.is_empty():
		return {"ok": false, "error": "HANDOFF_REQUIRED"}
	_serial += 1
	var command := {"command_id": "ui-" + str(_serial), "type": kind, "payload": payload}
	if _view.round != null:
		command["round_id"] = _view.round.round_id
		command["turn_id"] = _view.round.turn_id
		if _view.round.pending_sentence != null:
			command["proposal_id"] = _view.round.pending_sentence.id
	var result: Dictionary = _table.submit(command)
	_view = result.view.duplicate(true)
	if result.ok:
		_selected.clear()
		if kind in ["PROPOSE_SENTENCE", "DISCARD_TILE", "END_GAME", "START_NEXT_ROUND"]:
			_meme_keys.clear()
			_meme_expanded = false
			composer_reset.emit()
		_ballot_choice = null
		if kind != "DRAW_TILE": _drawn_tile = ""
		for event in result.events:
			if event.type == "TILE_DRAWN" and event.data.has("tile"):
				_drawn_tile = event.data.tile.id
	changed.emit()
	feedback.emit(result.duplicate(true))
	return result

func next_round() -> void:
	if _view.is_empty(): return
	var number: int = int(_view.round_number) + 1
	var tiles := _content.tiles(_deck_preset)
	if tiles.is_empty():
		notice.emit(_content.text("invalid_deck"))
		return
	dispatch("START_NEXT_ROUND", {"round_id": "round-" + str(number), "tiles": tiles,
		"seed": (_seed - 1 + number - 1) % 2147483646 + 1, "allow_extra_round": true})

func table_action(kind: String) -> void:
	if _view.is_empty() or _view.round == null: return
	match kind:
		"DRAW_TILE": dispatch("DRAW_TILE")
		"PLAY_TILE": play_tile()
		"MEMES":
			_meme_expanded = not _meme_expanded
			changed.emit()
		"CLEAR":
			_selected.clear()
			changed.emit()

func play_tile() -> void:
	if _view.is_empty() or _view.round == null: return
	var phase: String = _view.round.phase
	if _selected.size() == 1 and phase in ["AWAIT_ACTION", "MUST_DISCARD"]:
		discard_selected()
	elif phase == "AWAIT_ACTION" and _selected.size() >= int(_view.config.min_sentence_size):
		play_sentence()

func select_tile(id: String) -> void:
	if _view.is_empty() or _view.round == null: return
	if id in _selected:
		_selected.erase(id)
	else:
		_selected.append(id)
		if _view.round.phase == "AWAIT_ACTION" and _view.viewer_id == _view.round.active_player_id:
			_meme_expanded = true
	changed.emit()

func discard_selected() -> void:
	if _selected.size() == 1:
		dispatch("DISCARD_TILE", {"tile_id": _selected[0]})

func play_sentence() -> void:
	dispatch("PROPOSE_SENTENCE", {"tile_ids": _selected.duplicate(), "resource_keys": _meme_keys.duplicate()})

func selected_memes() -> Array:
	return _meme_keys.duplicate()

func toggle_meme(key: String) -> void:
	if _view.is_empty() or _view.round == null: return
	if key in _meme_keys:
		_meme_keys.erase(key)
	elif _meme_keys.size() < _view.config.max_meme_images:
		_meme_keys.append(key)
	else:
		notice.emit(_content.text("meme_limit"))
	changed.emit()

func move_meme(key: String, direction: int) -> void:
	_move_draft(_meme_keys, key, direction)

func reorder_tile(key: String, target: int) -> void:
	_reorder_draft(_selected, key, target)

func reorder_meme(key: String, target: int) -> void:
	_reorder_draft(_meme_keys, key, target)

func _move_draft(values: Array, key: String, direction: int) -> void:
	if absi(direction) != 1: return
	_reorder_draft(values, key, values.find(key) + direction)

func _reorder_draft(values: Array, key: String, target: int) -> void:
	var index := values.find(key)
	if index < 0 or target < 0 or target >= values.size(): return
	values.remove_at(index)
	values.insert(target, key)
	changed.emit()

func choose_ballot(approve: bool) -> void:
	if _view.is_empty() or _view.round == null or _view.round.phase != "AWAIT_VOTES": return
	var pending: Dictionary = _view.round.pending_sentence
	if pending.owner_id == _view.viewer_id or pending.has_voted: return
	if _view.round.pending_sentence.resource_keys.is_empty():
		dispatch("SUBMIT_VOTE", {"approve": approve, "rating": 0})
		return
	_ballot_choice = approve
	changed.emit()

func reset_ballot() -> void:
	_ballot_choice = null
	changed.emit()

func submit_rating(value: int) -> void:
	if _ballot_choice == null: return
	dispatch("SUBMIT_VOTE", {"approve": bool(_ballot_choice), "rating": value})
