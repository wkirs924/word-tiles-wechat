extends VBoxContainer
const Motion = preload("res://presentation/ui_motion.gd")
## Local slideshow only. Its timer never dispatches a game command.
var _keys: Array = []
var _index := 0
var _content: RefCounted
var _image: TextureRect
var _caption: Label
var _pause: Button
var _fade: Tween
var _timer: Timer

func setup(keys: Array, content: RefCounted) -> void:
	_keys = keys.duplicate()
	_content = content
	_image = TextureRect.new()
	_image.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_image.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_image.custom_minimum_size = Vector2(300, 200)
	add_child(_image)
	_caption = Label.new()
	_caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(_caption)
	var controls := HBoxContainer.new()
	controls.alignment = BoxContainer.ALIGNMENT_CENTER
	add_child(controls)
	var options_face: SystemFont = content.font("options")
	var previous := Button.new()
	previous.text = content.text("meme_previous")
	previous.pressed.connect(previous_image)
	if options_face != null:
		previous.add_theme_font_override("font", options_face)
	controls.add_child(previous)
	_pause = Button.new()
	_pause.pressed.connect(toggle_pause)
	if options_face != null:
		_pause.add_theme_font_override("font", options_face)
	controls.add_child(_pause)
	var next := Button.new()
	next.text = content.text("meme_next")
	next.pressed.connect(next_image)
	if options_face != null:
		next.add_theme_font_override("font", options_face)
	controls.add_child(next)
	_timer = Timer.new()
	_timer.name = "MemeTimer"
	_timer.wait_time = content.catalog.playback.seconds_per_image
	_timer.timeout.connect(next_image)
	add_child(_timer)
	controls.visible = _keys.size() > 1
	_show_image()
	_pause.text = content.text("meme_pause")
	if _keys.size() > 1: _timer.start()

func current_resource_key() -> String:
	return "" if _keys.is_empty() else str(_keys[_index])

func next_image() -> void:
	if _keys.is_empty(): return
	_index = (_index + 1) % _keys.size()
	_show_image()

func previous_image() -> void:
	if _keys.is_empty(): return
	_index = (_index - 1 + _keys.size()) % _keys.size()
	_show_image()

func toggle_pause() -> void:
	if _timer.is_stopped():
		_timer.start()
		_pause.text = _content.text("meme_pause")
	else:
		_timer.stop()
		_pause.text = _content.text("meme_play")

func _show_image() -> void:
	if _fade != null and _fade.is_valid(): _fade.kill()
	_image.modulate.a = 1.0 if Motion.reduced else 0.3
	_fade = create_tween()
	_fade.tween_property(_image, "modulate:a", 1.0, 0.22)
	_image.texture = _content.texture(current_resource_key())
	_caption.text = "%d / %d" % [_index + 1, _keys.size()]
	if _image.texture == null: _caption.text += " · " + _content.text("missing_image")
