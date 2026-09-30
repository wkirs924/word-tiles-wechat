extends Control
## Projected event feedback only. No signal or animation callback can advance play.
const Content = preload("res://presentation/content_store.gd")
const Motion = preload("res://presentation/ui_motion.gd")
var _content: Content
var _notice: Label
var _card_flash: Label
var _tween: Tween
var _event_tween: Tween

func _init(content: Content) -> void:
	_content = content
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func _ready() -> void:
	_notice = Label.new()
	_notice.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	_notice.offset_top = -28
	_notice.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_notice.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_notice)
	_card_flash = Label.new()
	_card_flash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_card_flash.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_card_flash.add_theme_font_size_override("font_size", 32)
	add_child(_card_flash)
	refresh_theme()

func refresh_theme() -> void:
	_card_flash.add_theme_color_override("font_color", _content.color("accent"))
	var score_face := _content.font("score")
	if score_face != null:
		_card_flash.add_theme_font_override("font", score_face)
	else:
		_card_flash.remove_theme_font_override("font")

func present(result: Dictionary) -> void:
	if result.ok:
		for event in result.events:
			if event.type in ["TILE_DRAWN", "TILE_DISCARDED", "SENTENCE_PROPOSED", "SENTENCE_ACCEPTED", "SENTENCE_REJECTED", "FINAL_SCORES"]:
				show_notice(_content.text("event_" + event.type))
				_animate_event(event)
	else:
		var code: String = result.receipt.get("error", "INVALID_COMMAND")
		show_notice(_content.text("error_" + code) if _content.catalog.ui.has("error_" + code) else _content.text("action_rejected") + " · " + code)

func show_notice(message: String) -> void:
	if _tween != null and _tween.is_valid(): _tween.kill()
	_notice.text = message
	_notice.modulate.a = 1.0
	_tween = create_tween()
	_tween.tween_interval(1.4)
	_tween.tween_property(_notice, "modulate:a", 0.0, 0.35)

func finish() -> void:
	if _event_tween != null and _event_tween.is_valid(): _event_tween.kill()
	if _tween != null and _tween.is_valid():
		_tween.kill()
	_notice.text = ""
	_card_flash.text = ""

func _animate_event(event: Dictionary) -> void:
	if Motion.reduced: return
	var text := ""
	if event.type in ["TILE_DRAWN", "TILE_DISCARDED"] and event.data.has("tile"):
		text = "「" + event.data.tile.glyph + "」"
	elif event.type == "SENTENCE_PROPOSED":
		return
	elif event.type == "SENTENCE_ACCEPTED":
		text = "+%.2f" % (event.data.sentence.score.total + float(event.data.sentence.rating_average.numerator) / 3.0)
	elif event.type == "FINAL_SCORES":
		text = _content.text("phase_completed")
	_card_flash.text = text
	_card_flash.position = Vector2(size.x / 2.0 - 200, 155)
	_card_flash.size = Vector2(400, 65)
	_card_flash.modulate.a = 1.0
	# Independent of notification duration, and never dispatches a completion command.
	if _event_tween != null and _event_tween.is_valid(): _event_tween.kill()
	_event_tween = create_tween().set_parallel(true)
	_event_tween.tween_property(_card_flash, "position:y", 130.0, 0.7).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	_event_tween.tween_property(_card_flash, "modulate:a", 0.0, 0.7)

func _exit_tree() -> void:
	finish()
