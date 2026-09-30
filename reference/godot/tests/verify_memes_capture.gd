extends SceneTree
## Throwaway rendering check for the new animated memes.
const Main = preload("res://presentation/main.gd")
var app: Control

func _initialize() -> void:
	call_deferred("_run")

func shot(name: String) -> void:
	await create_timer(0.6).timeout
	await process_frame
	await process_frame
	await RenderingServer.frame_post_draw
	var path := "res://.local/preview/" + name + ".png"
	print("SHOT: ", path, " result=", root.get_texture().get_image().save_png(path))

func _run() -> void:
	DirAccess.make_dir_recursive_absolute("res://.local/preview")
	root.size = Vector2i(1280, 800)
	app = Main.new()
	root.add_child(app)
	app.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	app.controller.start_game(42)
	app.controller.accept_handoff()
	app.controller.next_round()
	var dealer: String = app.controller.current_view().round.dealer_id
	app.controller.choose_seat(dealer)
	app.controller.accept_handoff()
	for tile in app.controller.current_view().round.hand:
		app.controller.select_tile(tile.id)
	for key in ["meme.gs.041", "meme.gs.013", "meme.gs.004", "meme.gs.056"]:
		app.controller.toggle_meme(key)
	await shot("meme-verify-composer")
	app.controller.play_sentence()
	await shot("meme-verify-vote")
	await create_timer(0.5).timeout
	await shot("meme-verify-vote2")
	await process_frame
	quit()
