extends Button
const Motion = preload("res://presentation/ui_motion.gd")
## Presentation-only image card. Name and keywords stay in the tooltip.

func setup(asset: Dictionary, content: RefCounted, order: int) -> void:
	custom_minimum_size = Vector2(156, 116)
	set_meta("meme_key", asset.key)
	set_meta("motion_key", "meme:" + asset.key)
	Motion.attach_hover(self)
	toggle_mode = true
	button_pressed = order >= 0
	mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	tooltip_text = asset.title + "\n" + " / ".join(asset.keywords)
	var background: Color = content.color("paper") if order >= 0 else content.color("surface")
	for state in ["normal", "hover", "pressed", "hover_pressed", "focus"]:
		var style := StyleBoxFlat.new()
		style.bg_color = background.lightened(0.08) if state.begins_with("hover") else background
		style.border_color = content.color("accent") if order >= 0 or state == "focus" else Color("49645a")
		style.set_border_width_all(2 if order >= 0 or state == "focus" else 1)
		style.set_corner_radius_all(9)
		style.shadow_color = Color("00000030")
		style.shadow_size = 4
		style.shadow_offset = Vector2(0, 2)
		if state == "focus": style.draw_center = false
		add_theme_stylebox_override(state, style)
	var picture := TextureRect.new()
	picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	picture.texture = content.preview_texture(asset.key)
	picture.position = Vector2(4, 4)
	picture.size = Vector2(148, 108)
	picture.set_meta("display_size", Vector2(148, 108))
	picture.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(picture)
	mouse_entered.connect(func():
		var animated: Texture2D = content.texture(asset.key)
		if animated != null and is_instance_valid(picture):
			picture.texture = animated)
	if order >= 0:
		var badge := Panel.new()
		badge.name = "SelectionBadge"
		badge.position = Vector2(125, 6)
		badge.size = Vector2(25, 22)
		badge.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var style := StyleBoxFlat.new()
		style.bg_color = Color("254c45")
		style.set_corner_radius_all(7)
		badge.add_theme_stylebox_override("panel", style)
		add_child(badge)
		var number := Label.new()
		number.text = str(order + 1)
		number.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		number.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		number.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		number.add_theme_color_override("font_color", Color.WHITE)
		number.add_theme_font_size_override("font_size", 13)
		number.mouse_filter = Control.MOUSE_FILTER_IGNORE
		badge.add_child(number)
