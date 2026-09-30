extends PanelContainer
signal dropped(key: String, target: int)
var item_key := ""
var group := ""
var index := 0
var title := ""

func _ready() -> void:
	mouse_default_cursor_shape = Control.CURSOR_DRAG
	focus_mode = Control.FOCUS_ALL
	focus_entered.connect(queue_redraw)
	focus_exited.connect(queue_redraw)
	mouse_entered.connect(func():
		if get_viewport().gui_is_dragging(): self_modulate = Color(1.2, 1.15, 1.0))
	mouse_exited.connect(func(): self_modulate = Color.WHITE)

func _gui_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode in [KEY_LEFT, KEY_RIGHT]:
			dropped.emit(item_key, index + (-1 if event.keycode == KEY_LEFT else 1))
			accept_event()

func _notification(what: int) -> void:
	if what == NOTIFICATION_DRAG_END: self_modulate = Color.WHITE

func _draw() -> void:
	if has_focus(): draw_rect(Rect2(Vector2.ONE, size - Vector2(2, 2)), Color("e4c086"), false, 2.0)

func _get_drag_data(_at: Vector2) -> Variant:
	var preview := Label.new()
	preview.text = title
	preview.add_theme_font_size_override("font_size", 28)
	set_drag_preview(preview)
	return {"kind": "word_tiles_order", "group": group, "key": item_key}

func _can_drop_data(_at: Vector2, data: Variant) -> bool:
	return data is Dictionary and data.get("kind") == "word_tiles_order" and data.get("group") == group and data.get("key") != item_key

func _drop_data(_at: Vector2, data: Variant) -> void:
	if _can_drop_data(_at, data): dropped.emit(data.key, index)
