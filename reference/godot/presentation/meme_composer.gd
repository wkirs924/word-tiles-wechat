extends RefCounted
## Owns search/scroll/animation state, never owns or mutates a game projection.
signal collapse_requested
signal toggle_requested(key: String)
signal move_requested(key: String, direction: int)
signal reorder_requested(key: String, target: int)
const MemeCard = preload("res://presentation/meme_card.gd")
const OrderedStrip = preload("res://presentation/ordered_strip.gd")
const Motion = preload("res://presentation/ui_motion.gd")
var _picker_motion := Motion.new()
var _meme_grid: HFlowContainer
var _scroll: ScrollContainer
var _scroll_value := 0
var _query := ""
var _keys: Array = []
var _glyphs: Array = []
const Content = preload("res://presentation/content_store.gd")
const Widgets = preload("res://presentation/ui_widgets.gd")
var _content: Content
var _ui: Widgets

func _init(content: Content, widgets: Widgets) -> void:
	_content = content
	_ui = widgets

func capture_scroll() -> void:
	if is_instance_valid(_scroll): _scroll_value = _scroll.scroll_vertical

func finish_animation() -> void:
	_picker_motion.finish()

func detach() -> void:
	finish_animation()
	_meme_grid = null
	_scroll = null
	_keys.clear()
	_glyphs.clear()

func reset() -> void:
	detach()
	_query = ""
	_scroll_value = 0

func render(parent: VBoxContainer, view: Dictionary, selected: Array, keys: Array) -> void:
	_keys = keys.duplicate()
	_glyphs.clear()
	for tile in view.round.hand:
		if tile.id in selected: _glyphs.append(tile.glyph)
	var heading := _ui.row(parent)
	_ui.label(heading, _content.text("meme_compose"), 20).size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_ui.label(heading, "%d / %d" % [_keys.size(), int(view.config.max_meme_images)], 15)
	var collapse := _ui.button(heading, _content.text("collapse"), collapse_requested.emit)
	collapse.add_theme_font_size_override("font_size", 14)
	var compact := StyleBoxEmpty.new()
	collapse.add_theme_stylebox_override("normal", compact)
	collapse.add_theme_color_override("font_color", Color("d6bf8b"))
	parent.add_theme_constant_override("separation", 8)
	var search := LineEdit.new()
	search.name = "MemeSearch"
	search.placeholder_text = _content.text("search")
	search.text = _query
	search.clear_button_enabled = true
	search.custom_minimum_size.y = 34
	parent.add_child(search)
	var items: Array = []
	for key in _keys:
		var title: String = key
		for asset in _content.catalog.assets:
			if asset.key == key: title = asset.title
		items.append({"key": key, "title": title})
	if not items.is_empty():
		var sequence := OrderedStrip.new()
		sequence.name = "MemeOrder"
		parent.add_child(sequence)
		sequence.setup(items, _content, "queue:")
		sequence.moved.connect(move_requested.emit)
		sequence.reordered.connect(reorder_requested.emit)
		sequence.removed.connect(toggle_requested.emit)
	_meme_grid = HFlowContainer.new()
	_meme_grid.add_theme_constant_override("h_separation", 6)
	_meme_grid.add_theme_constant_override("v_separation", 6)
	_scroll = ScrollContainer.new()
	_scroll.name = "MemeCandidates"
	_scroll.custom_minimum_size.y = 176
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	parent.add_child(_scroll)
	_meme_grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_scroll.add_child(_meme_grid)
	search.text_changed.connect(_render_meme_library)
	_render_meme_library(_query)
	_restore_scroll(_scroll, _scroll_value)

func _restore_scroll(scroll: ScrollContainer, value: int) -> void:
	# Scroll bounds are not valid until nested containers have finished layout.
	var tree := scroll.get_tree()
	await tree.process_frame
	await tree.process_frame
	if not is_instance_valid(scroll) or scroll != _scroll: return
	scroll.scroll_vertical = value

func _render_meme_library(query: String) -> void:
	if not is_instance_valid(_meme_grid): return
	var before := _picker_motion.capture(_meme_grid)
	_picker_motion.finish()
	_query = query
	for child in _meme_grid.get_children():
		_meme_grid.remove_child(child)
		child.queue_free()
	var matches := _content.meme_assets(query, _glyphs)
	if matches.is_empty():
		_ui.label(_meme_grid, _content.text("no_search_result"))
	for asset in matches:
		_meme_grid.add_child(_meme_card(asset))
	if not before.is_empty(): _picker_motion.transition(_meme_grid, before)

func _meme_card(asset: Dictionary) -> Control:
	var card := MemeCard.new()
	card.setup(asset, _content, _keys.find(asset.key))
	card.pressed.connect(toggle_requested.emit.bind(asset.key))
	return card
