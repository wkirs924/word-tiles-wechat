extends SceneTree
const Content = preload("res://presentation/content_store.gd")

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var c: RefCounted = Content.new()
	c.reload()
	root.size = Vector2i(900, 300)
	var bg := ColorRect.new()
	bg.color = Color("222222")
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.add_child(bg)
	var left := TextureRect.new()
	left.texture = c.texture("meme.gs.001")
	left.position = Vector2(20, 20)
	left.size = Vector2(400, 224)
	left.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	left.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	bg.add_child(left)
	var right := TextureRect.new()
	right.texture = (left.texture as AnimatedTexture).get_frame_texture(0)
	right.position = Vector2(460, 20)
	right.size = Vector2(400, 224)
	right.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	right.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	bg.add_child(right)
	await create_timer(0.8).timeout
	await process_frame
	await RenderingServer.frame_post_draw
	print("SAVE: ", root.get_texture().get_image().save_png("res://.local/preview/diag-compare.png"))
	quit()
