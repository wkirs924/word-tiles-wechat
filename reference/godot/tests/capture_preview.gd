extends SceneTree
## Optional rendering smoke check; run with a display, not --headless.
const Main = preload("res://presentation/main.gd")
var app: Control

func _initialize() -> void:
	call_deferred("_run")

func shot(name: String) -> void:
	await create_timer(0.35).timeout
	await process_frame
	await process_frame
	await RenderingServer.frame_post_draw
	var path := "res://.local/preview/" + name + ".png"
	var result := root.get_texture().get_image().save_png(path)
	print("PREVIEW: ", path, " result=", result)

func _run() -> void:
	DirAccess.make_dir_recursive_absolute("res://.local/preview")
	root.size = Vector2i(1280, 800)
	app = Main.new()
	root.add_child(app)
	app.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	await shot("01-menu")
	app.controller.start_game(42)
	await shot("02-handoff")
	app.controller.accept_handoff()
	await shot("10-ready")
	app.controller.next_round()
	var dealer: String = app.controller.current_view().round.dealer_id
	app.controller.choose_seat(dealer)
	app.controller.accept_handoff()
	await shot("03-table")
	for tile in app.controller.current_view().round.hand:
		app.controller.select_tile(tile.id)
	app.controller.toggle_meme("meme.gs.066")
	app.controller.toggle_meme("meme.gs.038")
	app.controller.toggle_meme("meme.gs.030")
	app.controller.toggle_meme("meme.gs.067")
	await shot("04-inline-memes")
	app.controller.play_sentence()
	await shot("06-vote")
	var voter: String = "东" if dealer != "东" else "南"
	app.controller.choose_seat(voter)
	app.controller.accept_handoff()
	await shot("11-decision")
	app.controller.choose_ballot(true)
	await shot("12-rating")
	root.size = Vector2i(1000, 700)
	await shot("13-rating-small")
	root.size = Vector2i(1280, 800)
	for player in ["东", "南", "西", "北"]:
		if player != dealer:
			app.controller.choose_seat(player)
			app.controller.accept_handoff()
			app.controller.dispatch("SUBMIT_VOTE", {"approve": true, "rating": 3})
	app.controller.choose_seat(dealer)
	app.controller.accept_handoff()
	await shot("05-completed")
	# Fresh live table with real discards and a newly drawn card.
	app.controller.start_game(42)
	app.controller.accept_handoff()
	app.controller.next_round()
	for index in range(4):
		var actor: String = app.controller.current_view().round.active_player_id
		app.controller.choose_seat(actor)
		app.controller.accept_handoff()
		if app.controller.current_view().round.phase == "AWAIT_DRAW": app.controller.dispatch("DRAW_TILE")
		app.controller.select_tile(app.controller.current_view().round.hand[0].id)
		app.controller.discard_selected()
	app.controller.choose_seat(app.controller.current_view().round.active_player_id)
	app.controller.accept_handoff()
	app.controller.dispatch("DRAW_TILE")
	await shot("07-draw")
	app.controller.select_tile(app.controller.current_view().round.hand[0].id)
	app.controller.select_tile(app.controller.current_view().round.hand[1].id)
	await shot("08-selected")
	root.size = Vector2i(1000, 700)
	await shot("09-small-window")
	app.queue_free()
	await process_frame
	quit()
