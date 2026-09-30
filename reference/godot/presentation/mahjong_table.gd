extends Control
## A visual table only. Receives a detached player projection; emits intentions.
signal seat_requested(player: String)
signal tile_selected(id: String)
signal selection_reordered(id: String, target: int)
const Motion = preload("res://presentation/ui_motion.gd")
const OrderedStrip = preload("res://presentation/ordered_strip.gd")
signal action_requested(kind: String)
var _canvas: Control
var _content: RefCounted
var _view: Dictionary
var _selection: Array
var _drawn := ""
var _overlay: VBoxContainer
var _overlay_panel: Panel
var _overlay_scroll: ScrollContainer
const W := 1280.0
const H := 720.0
const SEAT_COMPASS_TEXT := "东   南   西   北"

func setup(view: Dictionary, content: RefCounted, selection: Array, drawn: String) -> void:
	_view = view
	_content = content
	_selection = selection.duplicate()
	_drawn = drawn
	_canvas = Control.new()
	_canvas.size = Vector2(W, H)
	add_child(_canvas)
	resized.connect(_fit)
	_build()
	_fit()

func _fit() -> void:
	if _canvas == null: return
	var ratio := minf(size.x / W, size.y / H)
	_canvas.scale = Vector2.ONE * ratio
	_canvas.position = (size - Vector2(W, H) * ratio) / 2.0

func _box(rect: Rect2, color: Color, border: Color = Color.TRANSPARENT, radius: int = 12) -> Panel:
	var panel := Panel.new()
	panel.position = rect.position
	panel.size = rect.size
	panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var style := StyleBoxFlat.new()
	style.bg_color = color
	style.border_color = border
	style.set_border_width_all(1)
	style.set_corner_radius_all(radius)
	panel.add_theme_stylebox_override("panel", style)
	_canvas.add_child(panel)
	return panel

func _text(text: String, rect: Rect2, font_size: int = 20, color: Color = Color("f4efd8"), role: String = "default") -> Label:
	var label := Label.new()
	label.text = text
	label.position = rect.position
	label.size = rect.size
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	if role != "default":
		var face: SystemFont = _content.font(role)
		if face != null:
			label.add_theme_font_override("font", face)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_canvas.add_child(label)
	return label

func _image(key: String, rect: Rect2) -> TextureRect:
	var image := TextureRect.new()
	image.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	image.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	image.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_canvas.add_child(image)
	image.texture = _content.texture(key)
	image.position = rect.position
	image.size = rect.size
	image.set_meta("asset_key", key)
	image.set_meta("display_size", rect.size)
	return image

func _button(text: String, rect: Rect2, action: Callable, disabled: bool = false, gold: bool = false) -> Button:
	var button := Button.new()
	button.text = text
	button.position = rect.position
	button.size = rect.size
	button.disabled = disabled
	button.pressed.connect(action)
	Motion.attach_hover(button)
	button.add_theme_font_size_override("font_size", 21)
	var options_face: SystemFont = _content.font("options")
	if options_face != null:
		button.add_theme_font_override("font", options_face)
	for state in ["normal", "hover", "pressed", "disabled"]:
		var style := StyleBoxFlat.new()
		style.bg_color = _content.color("accent") if gold else _content.color("paper")
		if state == "hover": style.bg_color = Color("f4dca6")
		if state == "pressed": style.bg_color = Color("c5ad79")
		if state == "disabled": style.bg_color = Color("365b55")
		style.border_color = Color("ad8844") if gold else Color("87aa89")
		style.set_border_width_all(1)
		style.set_corner_radius_all(9)
		button.add_theme_stylebox_override(state, style)
	button.size = rect.size
	_canvas.add_child(button)
	return button

func _build() -> void:
	var round_view: Dictionary = _view.round
	_box(Rect2(10, 6, 1260, 700), Color("102d2ddd"), Color("a0ad7e44"), 48)
	_box(Rect2(148, 98, 984, 472), Color("214d4655"), Color("899b6d22"), 72)
	var players: Array = _view.players
	var viewer_index := players.find(_view.viewer_id)
	for relative in range(4):
		var player: String = players[(viewer_index + relative) % 4]
		_seat(player, relative)
		if relative != 0: _backs(int(round_view.hand_counts[player]), relative)
		_river(round_view.rivers[player], relative)
	_center()
	_hand()
	var live: bool = round_view.phase in ["AWAIT_DRAW", "AWAIT_ACTION", "MUST_DISCARD"]
	if live: _actions()
	else: _settlement_overlay()
	# Public history is opened on demand, preserving the table instead of a dashboard.
	_button(_content.text("accepted"), Rect2(956, 654, 192, 40), _show_history)

func _seat(player: String, relative: int) -> void:
	var origins := [Vector2(30, 538), Vector2(1135, 257), Vector2(1000, 24), Vector2(27, 257)]
	var p: Vector2 = origins[relative]
	var active: bool = player == _view.round.active_player_id
	_box(Rect2(p - Vector2(5, 5), Vector2(118, 155)), Color("103531"), Color("f3ce76") if active else Color("628a73"), 12)
	var index: int = _view.players.find(player)
	_image(["ui.avatar_east", "ui.avatar_south", "ui.avatar_west", "ui.avatar_north"][index], Rect2(p + Vector2(21, 2), Vector2(66, 66)))
	var badge: String = " · " + _content.text("dealer") if player == _view.round.dealer_id else ""
	_text(player + badge, Rect2(p + Vector2(0, 68), Vector2(108, 27)), 19, Color("ffda8c"))
	_text(str(_view.round.hand_counts[player]) + _content.text("tile_unit") + "  +" + str(_view.round.sentence_points[player]), Rect2(p + Vector2(0, 95), Vector2(108, 22)), 16)
	var button := _button(_content.text("you") if relative == 0 else _content.text("take_seat"), Rect2(p + Vector2(0, 119), Vector2(108, 30)), func(): seat_requested.emit(player))
	button.add_theme_font_size_override("font_size", 14)
	button.set_meta("seat_id", player)

func _backs(count: int, relative: int) -> void:
	for index in range(count):
		var rect: Rect2
		if relative == 2: rect = Rect2(405 + index * 31, 33, 30, 49)
		elif relative == 1: rect = Rect2(1100, 148 + index * 26, 29, 41)
		else: rect = Rect2(152, 148 + index * 26, 29, 41)
		var card := _image("ui.tile_back", rect)
		card.set_meta("hidden_card", true)

func _river(tiles: Array, relative: int) -> void:
	var origin: Vector2 = [Vector2(474, 382), Vector2(886, 189), Vector2(474, 111), Vector2(239, 189)][relative]
	var columns := 12 if relative in [0, 2] else 4
	var visible_tiles := mini(tiles.size(), 24)
	for index in range(visible_tiles):
		var rect := Rect2(origin + Vector2((index % columns) * 28, (index / columns) * 34), Vector2(26, 32))
		var tile: Dictionary = tiles[tiles.size() - visible_tiles + index]
		var image := _image("ui.tile", rect)
		image.set_meta("motion_key", "tile:" + tile.id)
		var label := _text(tile.glyph, rect, 20, Color("243f39"), "tile")
		label.reparent(image)
		label.position = Vector2.ZERO
	if tiles.size() > 24:
		_text("+" + str(tiles.size() - 24), Rect2(origin + Vector2(-38, 0), Vector2(36, 24)), 14)

func _center() -> void:
	var round_view: Dictionary = _view.round
	_box(Rect2(554, 249, 172, 126), Color("123e3ddd"), Color("b2bd7688"), 20)
	_text(SEAT_COMPASS_TEXT, Rect2(562, 256, 156, 27), 19, Color("e4c788"))
	_text(str(round_view.wall_remaining), Rect2(562, 285, 156, 50), 42, Color("f1d99a"))
	_text(_content.text("wall"), Rect2(562, 337, 156, 30), 15)
	_text(_content.text("round") + " %d  ·  %s %s" % [_view.round_number, _content.text("active"), round_view.active_player_id], Rect2(410, 215, 460, 30), 18)
	var dice: Array = round_view.dice
	_text("%s · %s" % [dice[0], dice[1]], Rect2(738, 304, 100, 35), 19, Color("d6e6d0"))

func _hand() -> void:
	var round_view: Dictionary = _view.round
	var count: int = round_view.hand.size()
	var width := minf(70.0, 980.0 / maxf(count, 1))
	var start := 178.0 + (980.0 - count * width) / 2.0
	for index in range(count):
		var tile: Dictionary = round_view.hand[index]
		var order := _selection.find(tile.id)
		var gap := 14.0 if tile.id == _drawn else 0.0
		var y := 541.0 if order >= 0 else 558.0
		var button := _button(tile.glyph, Rect2(start + index * width + gap, y, width - 3, 92), func(): tile_selected.emit(tile.id), round_view.phase not in ["AWAIT_ACTION", "MUST_DISCARD"] or _view.viewer_id != round_view.active_player_id)
		button.set_meta("tile_id", tile.id)
		button.set_meta("motion_key", "tile:" + tile.id)
		button.set_meta("motion_origin", Vector2(620, 300))
		button.add_theme_font_size_override("font_size", 37)
		var tile_face: SystemFont = _content.font("tile")
		if tile_face != null:
			button.add_theme_font_override("font", tile_face)
		for state in ["normal", "hover", "pressed", "disabled"]:
			var style := StyleBoxTexture.new()
			style.texture = _content.texture("ui.tile")
			style.modulate_color = Color("ffdf89") if order >= 0 else Color.WHITE
			button.add_theme_stylebox_override(state, style)
		button.add_theme_color_override("font_disabled_color", Color("344d42"))
		if order >= 0:
			var number := Label.new()
			number.text = str(order + 1)
			number.position = Vector2(0, 67)
			number.size = Vector2(width - 3, 20)
			number.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			number.add_theme_color_override("font_color", Color("86511c"))
			number.add_theme_font_size_override("font_size", 13)
			number.mouse_filter = Control.MOUSE_FILTER_IGNORE
			button.add_child(number)
		if tile.id == _drawn: _text(_content.text("new_tile"), Rect2(button.position - Vector2(0, 24), Vector2(width, 22)), 14, Color("ffe29c"))
	_text(_content.text("table_hint"), Rect2(195, 659, 715, 28), 15, _content.color("muted"))

func _actions() -> void:
	var own: bool = _view.viewer_id == _view.round.active_player_id
	var phase: String = _view.round.phase
	var draft := ""
	for id in _selection:
		for tile in _view.round.hand:
			if tile.id == id: draft += tile.glyph
	var message: String = _content.text("no_selection") if draft.is_empty() else draft
	if not own: message = _content.text("waiting_player") + _view.round.active_player_id
	if phase == "MUST_DISCARD": message = _content.text("phase_discard")
	if _selection.is_empty() or not own:
		_text(message, Rect2(282, 444, 710, 44), 22, Color("ffe2a2"))
	else:
		var sequence := OrderedStrip.new()
		_canvas.add_child(sequence)
		var items: Array = []
		for id in _selection:
			for tile in _view.round.hand:
				if tile.id == id: items.append({"key": id, "title": tile.glyph})
		sequence.setup(items, _content, "word:")
		sequence.custom_minimum_size.y = 46
		sequence.position = Vector2(256, 438)
		sequence.size = Vector2(768, 48)
		sequence.reordered.connect(func(id, target): selection_reordered.emit(id, target))
		sequence.removed.connect(func(id): tile_selected.emit(id))
	var can_discard: bool = _selection.size() == 1 and phase in ["AWAIT_ACTION", "MUST_DISCARD"]
	var can_sentence: bool = phase == "AWAIT_ACTION" and _selection.size() >= int(_view.config.min_sentence_size)
	_button(_content.text("meme_compose"), Rect2(292, 495, 132, 44), func(): action_requested.emit("MEMES"), not own or phase != "AWAIT_ACTION")
	_button(_content.text("draw"), Rect2(440, 495, 124, 44), func(): action_requested.emit("DRAW_TILE"), not own or phase != "AWAIT_DRAW", true)
	_button(_content.text("discard"), Rect2(578, 495, 124, 44), func(): action_requested.emit("PLAY_TILE"), not own or not (can_discard or can_sentence), true)
	_button(_content.text("clear"), Rect2(716, 495, 124, 44), func(): action_requested.emit("CLEAR"))

func composer_content() -> VBoxContainer:
	_settlement_overlay(358)
	return _overlay

func _settlement_overlay(height: float = 424) -> void:
	_overlay_panel = _box(Rect2(211, 72, 858, height), Color("102d2dfc"), Color("8c997055"), 20)
	_overlay_scroll = ScrollContainer.new()
	_overlay_scroll.position = Vector2(229, 86)
	_overlay_scroll.size = Vector2(822, height - 28)
	_overlay_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_canvas.add_child(_overlay_scroll)
	_overlay_panel.set_meta("motion_key", "overlay-panel")
	_overlay_scroll.set_meta("motion_key", "overlay-content")
	_overlay = VBoxContainer.new()
	_overlay.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_overlay.add_theme_constant_override("separation", 12)
	_overlay_scroll.add_child(_overlay)

func settlement_content() -> VBoxContainer:
	return _overlay

func _show_history() -> void:
	var dialog := AcceptDialog.new()
	dialog.title = _content.text("accepted")
	var lines: PackedStringArray = []
	for sentence in _view.round.sentences:
		lines.append("%s · %s  +%.2f" % [sentence.owner_id, sentence.text, sentence.score.total + float(sentence.rating_average.numerator) / 3.0])
	for player in _view.players:
		var glyphs := ""
		for tile in _view.round.rivers[player]: glyphs += tile.glyph + " "
		lines.append(player + " · " + _content.text("river") + "  " + glyphs)
	dialog.dialog_text = "\n".join(lines)
	dialog.confirmed.connect(dialog.queue_free)
	dialog.canceled.connect(dialog.queue_free)
	add_child(dialog)
	dialog.popup_centered(Vector2i(780, 400))
