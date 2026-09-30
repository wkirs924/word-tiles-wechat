extends ScrollContainer
## Editable display order. Emits intentions; never mutates the passed array.
signal moved(key: String, direction: int)
signal removed(key: String)
signal reordered(key: String, target: int)
const Chip = preload("res://presentation/order_chip.gd")
const Motion = preload("res://presentation/ui_motion.gd")

func setup(items: Array, content: RefCounted, prefix: String) -> void:
	custom_minimum_size.y = 58
	vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	add_child(row)
	for index in range(items.size()):
		var item: Dictionary = items[index]
		var panel := Chip.new()
		panel.item_key = item.key
		panel.group = prefix
		panel.index = index
		panel.title = item.title
		panel.tooltip_text = content.text("reorder_hint")
		panel.dropped.connect(func(key, target): reordered.emit(key, target))
		panel.set_meta("motion_key", prefix + item.key)
		var style := StyleBoxFlat.new()
		style.bg_color = Color("203e3d")
		style.set_corner_radius_all(9)
		style.content_margin_left = 8
		style.content_margin_right = 8
		panel.add_theme_stylebox_override("panel", style)
		row.add_child(panel)
		var box := HBoxContainer.new()
		box.add_theme_constant_override("separation", 4)
		panel.add_child(box)
		var title := Label.new()
		title.text = item.title if prefix == "word:" else str(index + 1) + " · " + item.title
		title.mouse_filter = Control.MOUSE_FILTER_IGNORE
		box.mouse_filter = Control.MOUSE_FILTER_IGNORE
		title.add_theme_font_size_override("font_size", 16)
		box.add_child(title)
		if prefix == "word:":
			panel.custom_minimum_size = Vector2(46, 38)
			title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			title.add_theme_font_size_override("font_size", 23)
			continue
		title.custom_minimum_size.x = 92
		title.clip_text = true
		title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		for direction in [-1, 1, 0]:
			var button := Button.new()
			button.text = "‹" if direction == -1 else ("›" if direction == 1 else "×")
			button.tooltip_text = content.text("meme_move_up" if direction == -1 else ("meme_move_down" if direction == 1 else "meme_remove"))
			button.flat = true
			button.custom_minimum_size = Vector2(30, 40)
			button.add_theme_color_override("font_color", Color("eddbb3"))
			button.add_theme_color_override("font_hover_color", Color.WHITE)
			button.disabled = (direction == -1 and index == 0) or (direction == 1 and index == items.size() - 1)
			button.pressed.connect(func():
				if direction == 0: removed.emit(item.key)
				else: moved.emit(item.key, direction))
			box.add_child(button)
			Motion.attach_hover(button)
