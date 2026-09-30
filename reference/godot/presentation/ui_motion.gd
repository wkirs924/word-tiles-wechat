extends RefCounted
## Only transient geometry is retained. No authority, tile values or callbacks to rules.
var _running: Array = []
var _generation := 0
static var reduced := false

func capture(root: Node) -> Dictionary:
	var result := {}
	for control in _controls(root):
		result[control.get_meta("motion_key")] = control.global_position
	return result

func transition(root: Control, before: Dictionary) -> void:
	_generation += 1
	var generation := _generation
	# Containers must first finish their layout. Authority has already advanced.
	var tree := root.get_tree()
	await tree.process_frame
	await tree.process_frame
	if not is_instance_valid(root) or generation != _generation or not root.is_inside_tree(): return
	if reduced: return
	var index := 0
	for control in _controls(root):
		var destination: Vector2 = control.position
		var key: String = control.get_meta("motion_key")
		var start := destination + Vector2(0, 12)
		if before.has(key):
			start = control.get_parent().get_global_transform().affine_inverse() * before[key]
		else:
			start = control.get_meta("motion_origin", start)
			control.modulate.a = 0.0
		if start.distance_to(destination) < 0.5 and control.modulate.a == 1.0: continue
		control.position = start
		var tween: Tween = control.create_tween().set_parallel(true)
		tween.set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
		tween.tween_property(control, "position", destination, 0.28)
		tween.tween_property(control, "modulate:a", 1.0, 0.18).set_delay(minf(index * 0.012, 0.12) if not before.has(key) else 0.0)
		_running.append({"node": weakref(control), "tween": tween, "position": destination})
		index += 1
	_running = _running.filter(func(item): return item.tween.is_valid())

func finish() -> void:
	_generation += 1
	for item in _running:
		if item.tween.is_valid(): item.tween.kill()
		var control = item.node.get_ref()
		if is_instance_valid(control):
			control.position = item.position
			control.modulate.a = 1.0
	_running.clear()

func _controls(node: Node) -> Array:
	var result: Array = []
	if node is Control and node.has_meta("motion_key"):
		result.append(node)
	for child in node.get_children(): result.append_array(_controls(child))
	return result

static func attach_hover(button: Button) -> void:
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.mouse_entered.connect(func():
		if button.disabled or reduced: return
		button.pivot_offset = button.size / 2.0
		_hover_to(button, 1.035))
	button.mouse_exited.connect(func(): _hover_to(button, 1.0))
	button.button_down.connect(func(): _hover_to(button, 0.97))
	button.button_up.connect(func(): _hover_to(button, 1.0))

static func _hover_to(button: Button, factor: float) -> void:
	if reduced:
		button.scale = Vector2.ONE
		return
	var old: Tween = button.get_meta("hover_tween") if button.has_meta("hover_tween") else null
	if old != null and old.is_valid(): old.kill()
	var tween := button.create_tween()
	tween.tween_property(button, "scale", Vector2.ONE * factor, 0.12).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	button.set_meta("hover_tween", tween)
