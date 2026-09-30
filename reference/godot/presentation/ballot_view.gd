extends RefCounted
const Content = preload("res://presentation/content_store.gd")
## Render a detached player projection and emit intentions; never submit commands.
signal decision_requested(approve: bool)
signal rating_requested(value: int)
signal back_requested
const MemePlayer = preload("res://presentation/meme_player.gd")
const Widgets = preload("res://presentation/ui_widgets.gd")
var _content: Content
var _ui: Widgets

func _init(content: Content, widgets: Widgets) -> void:
	_content = content
	_ui = widgets

func render(parent: VBoxContainer, view: Dictionary, choice: Variant) -> void:
	var pending: Dictionary = view.round.pending_sentence
	var title := _ui.label(parent, pending.owner_id + " · " + pending.text, 25, "vote")
	title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	var columns := _ui.row(parent)
	if not pending.resource_keys.is_empty():
		var slideshow := MemePlayer.new()
		slideshow.name = "ProposalMemePlayer"
		slideshow.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		columns.add_child(slideshow)
		slideshow.setup(pending.resource_keys, _content)
	var ballot := VBoxContainer.new()
	ballot.name = "BallotPanel"
	ballot.custom_minimum_size.x = 346
	ballot.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	ballot.add_theme_constant_override("separation", 18)
	columns.add_child(ballot)
	_ui.label(ballot, _content.text("vote_progress") + " %d / 3" % pending.votes_received, 17, "vote")
	var progress := ProgressBar.new()
	progress.max_value = 3
	progress.value = pending.votes_received
	progress.show_percentage = false
	progress.custom_minimum_size.y = 6
	ballot.add_child(progress)
	if pending.owner_id == view.viewer_id or pending.has_voted:
		_render_waiting(ballot, pending.has_voted)
		return
	if choice == null:
		_render_decision(ballot)
	else:
		_render_rating(ballot, view.config)

func _render_waiting(ballot: VBoxContainer, has_voted: bool) -> void:
	_ui.label(ballot, _content.text("ballot_done" if has_voted else "ballot_wait"), 24, "vote").autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_ui.label(ballot, _content.text("ballot_privacy"), 16, "vote").autowrap_mode = TextServer.AUTOWRAP_WORD_SMART

func _render_decision(ballot: VBoxContainer) -> void:
	ballot.set_meta("motion_key", "ballot-decision")
	var heading := _ui.label(ballot, _content.text("decision_title"), 22, "vote")
	heading.name = "DecisionTitle"
	heading.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	var actions := _ui.row(ballot)
	actions.name = "DecisionActions"
	actions.alignment = BoxContainer.ALIGNMENT_CENTER
	for accepted in [true, false]:
		var button := _ui.button(actions, _content.text("approve" if accepted else "oppose"), decision_requested.emit.bind(accepted))
		button.custom_minimum_size = Vector2(132, 46)
		button.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
		button.add_theme_font_size_override("font_size", 16)

func _render_rating(ballot: VBoxContainer, config: Dictionary) -> void:
	ballot.set_meta("motion_key", "ballot-rating")
	_ui.label(ballot, _content.text("rating_title"), 24, "vote")
	_ui.label(ballot, _content.text("rating_hint"), 16, "vote").autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	var row := _ui.row(ballot)
	for value in range(int(config.rating_min), int(config.rating_max) + 1):
		var button := _ui.button(row, str(value), rating_requested.emit.bind(value))
		button.custom_minimum_size = Vector2(72, 86)
		button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		button.set_meta("rating_value", value)
		for state in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
			button.add_theme_color_override(state, Color.TRANSPARENT)
		var face := StyleBoxFlat.new()
		face.bg_color = Color.TRANSPARENT
		face.border_color = Color(_content.color("digital"), 0.38)
		face.set_border_width_all(1)
		face.set_corner_radius_all(10)
		button.add_theme_stylebox_override("normal", face)
		for state in ["hover", "pressed", "focus"]:
			var lit := face.duplicate()
			lit.bg_color = Color(_content.color("digital"), 0.10)
			lit.border_color = Color(_content.color("digital"), 0.72)
			button.add_theme_stylebox_override(state, lit)
		var number := _ui.number(button, str(value), 48)
		number.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		number.offset_left = 12
		number.offset_right = -12
		number.offset_top = 15
		number.offset_bottom = -15
	_ui.button(ballot, _content.text("decision_back"), back_requested.emit)
