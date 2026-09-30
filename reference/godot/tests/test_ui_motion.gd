extends RefCounted
const Motion = preload("res://presentation/ui_motion.gd")
var checks := 0
var failures := 0

func check(value: bool, message: String) -> void:
	checks += 1
	if not value:
		failures += 1
		push_error("FAIL: motion " + message)

func run(tree: SceneTree) -> bool:
	print("TEST visual motion: interpolation / interruption / reduced motion / freed view")
	var root := Control.new()
	tree.root.add_child(root)
	var card := Control.new()
	card.set_meta("motion_key", "test-card")
	root.add_child(card)
	card.position = Vector2(20, 20)
	var motion := Motion.new()
	var before := motion.capture(root)
	card.position = Vector2(220, 20)
	await motion.transition(root, before)
	check(card.position == Vector2(20, 20), "reordering begins at the old visual location")
	motion.finish()
	check(card.position == Vector2(220, 20) and card.modulate.a == 1.0, "skip restores exact destination")
	before = motion.capture(root)
	card.position = Vector2(420, 20)
	motion.transition(root, before)
	motion.finish()
	await tree.process_frame
	await tree.process_frame
	await tree.process_frame
	check(card.position == Vector2(420, 20), "cancelled deferred transition cannot restart")
	Motion.reduced = true
	before = motion.capture(root)
	card.position = Vector2(620, 20)
	motion.transition(root, before)
	await tree.process_frame
	await tree.process_frame
	await tree.process_frame
	check(card.position == Vector2(620, 20), "reduced motion keeps final layout")
	Motion.reduced = false
	motion.transition(root, {})
	root.queue_free()
	await tree.process_frame
	await tree.process_frame
	await tree.process_frame
	motion.finish()
	await _drag_check(tree)
	return true

func _drag_check(tree: SceneTree) -> void:
	var previous_size := tree.root.size
	tree.root.size = Vector2i(1280, 800)
	var content := preload("res://presentation/content_store.gd").new()
	content.reload()
	var strip := preload("res://presentation/ordered_strip.gd").new()
	tree.root.add_child(strip)
	strip.position = Vector2(20, 20)
	strip.size = Vector2(300, 60)
	strip.setup([{"key": "a", "title": "字"}, {"key": "b", "title": "有"}, {"key": "c", "title": "趣"}], content, "word:")
	var delivered: Array = []
	strip.reordered.connect(func(key, target): delivered.append([key, target]))
	await tree.process_frame
	await tree.process_frame
	var source: Vector2 = strip.get_child(0).get_child(0).get_global_rect().get_center()
	var target: Vector2 = strip.get_child(0).get_child(2).get_global_rect().get_center()
	_mouse_button(tree, source, true)
	_mouse_move(tree, source + Vector2(18, 0), Vector2(18, 0))
	await tree.process_frame
	_mouse_move(tree, target, target - source - Vector2(18, 0))
	await tree.process_frame
	_mouse_button(tree, target, false)
	check(delivered == [["a", 2]], "real pointer drag emits the requested target position")
	strip.queue_free()
	await tree.process_frame
	tree.root.size = previous_size

func _mouse_button(tree: SceneTree, point: Vector2, pressed: bool) -> void:
	var event := InputEventMouseButton.new()
	event.position = point
	event.global_position = point
	event.button_index = MOUSE_BUTTON_LEFT
	event.pressed = pressed
	tree.root.push_input(event, true)

func _mouse_move(tree: SceneTree, point: Vector2, relative: Vector2) -> void:
	var event := InputEventMouseMotion.new()
	event.position = point
	event.global_position = point
	event.relative = relative
	event.button_mask = MOUSE_BUTTON_MASK_LEFT
	tree.root.push_input(event, true)
