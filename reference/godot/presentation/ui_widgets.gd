extends RefCounted
const Content = preload("res://presentation/content_store.gd")
## Small widget factory shared by screens. Owns no controls or game state.
const Motion = preload("res://presentation/ui_motion.gd")
const DigitalNumber = preload("res://presentation/digital_number.gd")
var _content: Content

func _init(content: Content) -> void:
	_content = content

func label(parent: Node, text: String, size: int = 18, role: String = "default") -> Label:
	var label := Label.new()
	label.text = text
	label.add_theme_font_size_override("font_size", size)
	if role != "default":
		var face := _content.font(role)
		if face != null:
			label.add_theme_font_override("font", face)
	parent.add_child(label)
	return label

func button(parent: Node, title: String, action: Callable, disabled: bool = false) -> Button:
	var button := Button.new()
	button.text = title
	button.disabled = disabled
	button.pressed.connect(action)
	Motion.attach_hover(button)
	var face := _content.font("options")
	if face != null:
		button.add_theme_font_override("font", face)
	parent.add_child(button)
	return button

func row(parent: Node) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	parent.add_child(row)
	return row

func panel(parent: Node) -> VBoxContainer:
	var panel := PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = _content.color("surface")
	style.set_corner_radius_all(22)
	style.border_color = Color("69847866")
	style.set_border_width_all(1)
	style.shadow_color = Color("00000040")
	style.shadow_size = 18
	style.content_margin_left = 18
	style.content_margin_right = 18
	style.content_margin_top = 14
	style.content_margin_bottom = 14
	panel.add_theme_stylebox_override("panel", style)
	panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	parent.add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	panel.add_child(box)
	return box

func number(parent: Node, value: String, height: float) -> Control:
	var number := DigitalNumber.new()
	number.setup(value, height, _content.color("digital"))
	parent.add_child(number)
	return number
