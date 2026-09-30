extends RefCounted
## Shared theme construction; no scene or game state.

static func build(content: RefCounted) -> Theme:
	var style := Theme.new()
	var font: Font = content.font()
	if font == null:
		var fallback := SystemFont.new()
		fallback.font_names = PackedStringArray(["Microsoft YaHei", "Noto Sans CJK SC", "Arial"])
		font = fallback
	style.default_font = font
	style.default_font_size = content.font_size()
	style.set_color("font_color", "Label", content.color("paper"))
	style.set_color("font_color", "Button", content.color("ink"))
	for state in ["hover", "pressed", "focus", "hover_pressed"]:
		style.set_color("font_" + state + "_color", "Button", content.color("ink"))
	style.set_color("font_disabled_color", "Button", Color("b5c8bf"))
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		style.set_color(state, "OptionButton", content.color("ink"))
	for kind in ["LineEdit", "SpinBox"]:
		style.set_color("font_color", kind, Color("f5eee0"))
	var input_box := StyleBoxFlat.new()
	input_box.bg_color = Color("102c2d")
	input_box.border_color = Color("49625a")
	input_box.set_border_width_all(1)
	input_box.set_corner_radius_all(8)
	input_box.content_margin_left = 12
	input_box.content_margin_right = 12
	input_box.content_margin_top = 7
	input_box.content_margin_bottom = 7
	style.set_stylebox("normal", "LineEdit", input_box)
	var focused := input_box.duplicate()
	focused.border_color = Color("ddbc7a")
	style.set_stylebox("focus", "LineEdit", focused)
	style.set_color("font_placeholder_color", "LineEdit", Color("93aaa1"))
	for state in ["normal", "hover", "pressed", "disabled"]:
		var box := StyleBoxFlat.new()
		box.bg_color = content.color("paper") if state == "normal" else content.color("accent")
		if state == "disabled":
			box.bg_color = Color("647573")
		box.set_corner_radius_all(8)
		box.shadow_color = Color("00000024")
		box.shadow_size = 3
		box.shadow_offset = Vector2(0, 2)
		box.content_margin_left = 16
		box.content_margin_right = 16
		box.content_margin_top = 11
		box.content_margin_bottom = 11
		style.set_stylebox(state, "Button", box)
	var focus_ring := StyleBoxFlat.new()
	focus_ring.draw_center = false
	focus_ring.border_color = content.color("accent")
	focus_ring.set_border_width_all(2)
	focus_ring.set_corner_radius_all(8)
	style.set_stylebox("focus", "Button", focus_ring)
	for bar in ["HScrollBar", "VScrollBar"]:
		for state in ["scroll", "grabber", "grabber_highlight", "grabber_pressed"]:
			var track := StyleBoxFlat.new()
			track.bg_color = Color("102b2d") if state == "scroll" else Color("648277")
			if state in ["grabber_highlight", "grabber_pressed"]: track.bg_color = content.color("accent")
			track.set_corner_radius_all(4)
			track.content_margin_left = 4
			track.content_margin_right = 4
			track.content_margin_top = 4
			track.content_margin_bottom = 4
			style.set_stylebox(state, bar, track)
	return style
