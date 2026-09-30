extends RefCounted
## Menu, privacy handoff and ready room. Signals are the only outgoing actions.
signal start_requested(seed_value: int)
signal preset_selected(key: String)
signal handoff_confirmed
signal round_requested
const Content = preload("res://presentation/content_store.gd")
const Widgets = preload("res://presentation/ui_widgets.gd")
var _content: Content
var _ui: Widgets

func _init(content: Content, widgets: Widgets) -> void:
	_content = content
	_ui = widgets

func menu(parent: Control, seed_value: int, deck_preset: String) -> void:
	var center := CenterContainer.new()
	center.size_flags_vertical = Control.SIZE_EXPAND_FILL
	parent.add_child(center)
	var box := _ui.panel(center)
	box.get_parent().set_meta("motion_key", "menu")
	box.custom_minimum_size.x = 640
	var logo := TextureRect.new()
	logo.texture = _content.texture("ui.mark")
	logo.custom_minimum_size = Vector2(100, 100)
	logo.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	logo.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	box.add_child(logo)
	_ui.label(box, _content.text("title"), 46).horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_ui.label(box, _content.text("subtitle"), 22).horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_ui.label(box, _content.text("menu_hint"), 16)
	var seed_input := SpinBox.new()
	seed_input.min_value = 1
	seed_input.max_value = 2147483646
	seed_input.value = seed_value
	seed_input.prefix = _content.text("seed")
	box.add_child(seed_input)
	var decks := OptionButton.new()
	decks.name = "DeckPreset"
	var deck_suffix := " · 136" + _content.text("tile_unit")
	var selected_index := 0
	for preset in _content.catalog.get("deck_presets", []):
		decks.add_item(preset.title + deck_suffix)
		var index := decks.item_count - 1
		decks.set_item_metadata(index, preset.id)
		if deck_preset == preset.id: selected_index = index
	if decks.item_count == 0:
		decks.add_item("当前自定义字库" + deck_suffix)
		decks.set_item_metadata(0, "")
	decks.select(selected_index)
	preset_selected.emit(decks.get_item_metadata(decks.selected))
	decks.item_selected.connect(func(index): preset_selected.emit(decks.get_item_metadata(index)))
	box.add_child(decks)
	_ui.button(box, _content.text("new_game"), func(): start_requested.emit(int(seed_input.value)))
	if not _content.error.is_empty():
		_ui.label(box, _content.error)

func handoff(parent: Control, player: String, allowed: bool) -> void:
	var center := CenterContainer.new()
	center.size_flags_vertical = Control.SIZE_EXPAND_FILL
	parent.add_child(center)
	var box := _ui.panel(center)
	box.get_parent().set_meta("motion_key", "handoff")
	box.custom_minimum_size.x = 580
	_ui.label(box, _content.text("handoff"), 24).horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_ui.label(box, player + "  ·  " + _content.text("seat"), 62).horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_ui.label(box, _content.text("handoff_hint"), 17)
	_ui.button(box, _content.text("confirm"), handoff_confirmed.emit, not allowed)

func ready_room(parent: Control, view: Dictionary) -> void:
	var center := CenterContainer.new()
	center.size_flags_vertical = Control.SIZE_EXPAND_FILL
	parent.add_child(center)
	var box := _ui.panel(center)
	box.custom_minimum_size.x = 650
	box.get_parent().set_meta("motion_key", "ready-room")
	_ui.label(box, _content.text("ready_title"), 32).horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_ui.label(box, _content.text("ready"), 17).horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	var seats := _ui.row(box)
	seats.alignment = BoxContainer.ALIGNMENT_CENTER
	for seat in view.players:
		var badge := _ui.panel(seats)
		_ui.label(badge, seat, 30).horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		_ui.label(badge, _content.text("ready_seat"), 14)
	_ui.button(box, _content.text("new_game"), round_requested.emit, view.viewer_id != view.host_player_id)
