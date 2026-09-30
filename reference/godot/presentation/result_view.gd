extends RefCounted
const Content = preload("res://presentation/content_store.gd")
## Render a detached player projection and emit intentions; never submit commands.
signal next_requested
const Widgets = preload("res://presentation/ui_widgets.gd")
var _content: Content
var _ui: Widgets

func _init(content: Content, widgets: Widgets) -> void:
	_content = content
	_ui = widgets

func render(parent: VBoxContainer, view: Dictionary) -> void:
	parent.add_theme_constant_override("separation", 8)
	_ui.label(parent, _content.text("phase_completed") if view.round.phase != "ABORTED" else _content.text("aborted_hint"), 26, "score")
	if view.round.phase != "ABORTED":
		var grid := GridContainer.new()
		grid.columns = 5
		grid.add_theme_constant_override("h_separation", 24)
		grid.add_theme_constant_override("v_separation", 6)
		parent.add_child(grid)
		for title in [_content.text("seat"), _content.text("sentence_points"), _content.text("meme_points"), _content.text("penalty"), _content.text("round_points")]:
			_ui.label(grid, title, 15, "score").size_flags_horizontal = Control.SIZE_EXPAND_FILL
		for player in view.players:
			var score: Dictionary = view.round.result.scores[player]
			for value in [player, str(score.sentence_points), "%.2f" % (float(score.rating_bonus.numerator) / 3.0), ("−%d" % score.remaining_tiles) if score.remaining_tiles > 0 else "0", "%.2f" % (float(score.total.numerator) / 3.0)]:
				if value == player: _ui.label(grid, value, 20, "score")
				else: _ui.number(grid, value, 26)
	_ui.label(parent, _content.text("ranking"), 20, "score")
	var podium := _ui.row(parent)
	for entry in view.ranking:
		var box := _ui.panel(podium)
		box.add_theme_constant_override("separation", 2)
		var surface: StyleBoxFlat = box.get_parent().get_theme_stylebox("panel").duplicate()
		surface.content_margin_top = 8
		surface.content_margin_bottom = 8
		box.get_parent().add_theme_stylebox_override("panel", surface)
		box.get_parent().set_meta("motion_key", "result:" + entry.player_id)
		_ui.label(box, "%d · %s" % [entry.rank, entry.player_id], 16, "score")
		_ui.number(box, "%.2f" % (float(entry.total.numerator) / float(entry.total.denominator)), 38)
	_ui.button(parent, _content.text("next_round"), next_requested.emit, view.viewer_id != view.host_player_id)
