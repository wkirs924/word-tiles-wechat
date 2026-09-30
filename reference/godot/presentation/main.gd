extends Control
const GameController = preload("res://presentation/game_controller.gd")
const Content = preload("res://presentation/content_store.gd")
const MahjongTable = preload("res://presentation/mahjong_table.gd")
const Motion = preload("res://presentation/ui_motion.gd")
const UiTheme = preload("res://presentation/ui_theme.gd")
const Widgets = preload("res://presentation/ui_widgets.gd")
const BallotView = preload("res://presentation/ballot_view.gd")
const ResultView = preload("res://presentation/result_view.gd")
const LobbyScreens = preload("res://presentation/lobby_screens.gd")
const MemeComposer = preload("res://presentation/meme_composer.gd")
const EventFeedback = preload("res://presentation/event_feedback.gd")
var _content := Content.new()
# Public intent API for integration tests and future input adapters.
var controller := GameController.new(_content)
var _ui := Widgets.new(_content)
var _ballot := BallotView.new(_content, _ui)
var _result := ResultView.new(_content, _ui)
var _lobby := LobbyScreens.new(_content, _ui)
var _composer := MemeComposer.new(_content, _ui)
var _feedback := EventFeedback.new(_content)
var _layout: VBoxContainer
var _background: TextureRect
var _motion := Motion.new()

func _ready() -> void:
	_content.reload()
	controller.changed.connect(_render)
	controller.composer_reset.connect(_composer.reset)
	controller.feedback.connect(_feedback.present)
	controller.notice.connect(_feedback.show_notice)
	_ballot.decision_requested.connect(controller.choose_ballot)
	_ballot.rating_requested.connect(controller.submit_rating)
	_ballot.back_requested.connect(controller.reset_ballot)
	_result.next_requested.connect(controller.next_round)
	_lobby.start_requested.connect(controller.start_game)
	_lobby.preset_selected.connect(controller.set_deck_preset)
	_lobby.handoff_confirmed.connect(controller.accept_handoff)
	_lobby.round_requested.connect(controller.next_round)
	_composer.collapse_requested.connect(func(): controller.table_action("MEMES"))
	_composer.toggle_requested.connect(controller.toggle_meme)
	_composer.move_requested.connect(controller.move_meme)
	_composer.reorder_requested.connect(controller.reorder_meme)
	_background = TextureRect.new()
	_background.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_background.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_background.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	_background.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_background)
	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 26)
	add_child(margin)
	_layout = VBoxContainer.new()
	_layout.add_theme_constant_override("separation", 16)
	margin.add_child(_layout)
	add_child(_feedback)
	_feedback.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_apply_theme()
	controller.show_menu()

func _apply_theme() -> void:
	theme = UiTheme.build(_content)
	_feedback.refresh_theme()
	_background.texture = _content.texture("ui.background")
	RenderingServer.set_default_clear_color(_content.color("background"))

func _clear() -> void:
	skip_animation()
	_composer.detach()
	for child in _layout.get_children():
		_layout.remove_child(child)
		child.queue_free()

func _header() -> void:
	var row := _ui.row(_layout)
	var title := _ui.label(row, _content.text("title"), 32)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_ui.button(row, _content.text("reload"), reload_content)
	_ui.button(row, _content.text("editor"), open_editor)
	_ui.button(row, _content.text("skip"), skip_animation)
	var motion_button := _ui.button(row, _content.text("motion_reduced" if Motion.reduced else "motion_full"), func(): pass)
	motion_button.pressed.connect(func():
		Motion.reduced = not Motion.reduced
		skip_animation()
		motion_button.text = _content.text("motion_reduced" if Motion.reduced else "motion_full"))

func _render() -> void:
	var before := _motion.capture(_layout)
	var focused := get_viewport().gui_get_focus_owner()
	var focus_key: String = focused.get_meta("motion_key", "") if focused != null else ""
	_composer.capture_scroll()
	_clear()
	_header()
	var screen := controller.screen_state()
	if screen.screen == "MENU":
		_lobby.menu(_layout, screen.seed, screen.deck_preset)
		_motion.transition(_layout, {})
		return
	if screen.screen == "HANDOFF":
		_lobby.handoff(_layout, screen.pending_seat, screen.handoff_allowed)
		_motion.transition(_layout, {})
		return
	var view := controller.current_view()
	var draft := controller.draft()
	if view.round == null:
		_lobby.ready_room(_layout, view)
		_motion.transition(_layout, before)
		return
	var board := MahjongTable.new()
	board.name = "MahjongTable"
	board.size_flags_vertical = Control.SIZE_EXPAND_FILL
	board.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_layout.add_child(board)
	board.setup(view, _content, draft.tile_ids, draft.drawn_tile)
	board.seat_requested.connect(controller.choose_seat)
	board.tile_selected.connect(controller.select_tile)
	board.selection_reordered.connect(controller.reorder_tile)
	board.action_requested.connect(controller.table_action)
	var phase: String = view.round.phase
	var show_composer: bool = phase == "AWAIT_ACTION" and view.viewer_id == view.round.active_player_id and draft.meme_expanded
	if phase in ["COMPLETED", "ABORTED"]:
		_result.render(board.settlement_content(), view)
	elif phase == "AWAIT_VOTES":
		_ballot.render(board.settlement_content(), view, draft.ballot_choice)
	elif show_composer:
		_composer.render(board.composer_content(), view, draft.tile_ids, draft.meme_keys)
	var footer := _ui.row(_layout)
	_ui.label(footer, _content.text("footer"), 14).size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if view.viewer_id == view.host_player_id and phase not in ["COMPLETED", "ABORTED"]:
		_ui.button(footer, _content.text("end_game"), confirm_end)
	if phase in ["COMPLETED", "ABORTED"]:
		_ui.button(footer, _content.text("back"), controller.show_menu)
	_motion.transition(_layout, before)
	if not focus_key.is_empty(): _restore_focus.call_deferred(focus_key)

func _restore_focus(key: String) -> void:
	for control in _layout.find_children("*", "Control", true, false):
		if control.get_meta("motion_key", "") == key:
			control.grab_focus()
			return

func confirm_end() -> void:
	var dialog := ConfirmationDialog.new()
	dialog.dialog_text = _content.text("end_confirm")
	dialog.confirmed.connect(func(): dialog.queue_free(); controller.dispatch("END_GAME"))
	dialog.canceled.connect(dialog.queue_free)
	add_child(dialog)
	dialog.popup_centered(Vector2i(460, 180))

func skip_animation() -> void:
	_motion.finish()
	_composer.finish_animation()
	_feedback.finish()

func reload_content() -> void:
	if not _content.reload():
		_feedback.show_notice(_content.error)
		return
	_apply_theme()
	_render()
	_feedback.show_notice(_content.text("reloaded"))

func open_editor() -> void:
	if OS.get_name() == "Windows":
		OS.create_process("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", ProjectSettings.globalize_path("res://scripts/start_editor.ps1"), "-OpenBrowser"])
	else:
		OS.shell_open("http://127.0.0.1:8765")

func _exit_tree() -> void:
	_motion.finish()
	_composer.reset()
