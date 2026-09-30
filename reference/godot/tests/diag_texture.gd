extends SceneTree
const Content = preload("res://presentation/content_store.gd")

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var c: RefCounted = Content.new()
	c.reload()
	var asset: Dictionary = {}
	for a in c.catalog.assets:
		if a.key == "meme.gs.001":
			asset = a
	print("size_hint=", asset.size_hint)
	var t: Texture2D = c.texture("meme.gs.001")
	print("class=", t.get_class())
	if t is AnimatedTexture:
		var animated: AnimatedTexture = t
		print("frames=", animated.frames)
		var f0: Texture2D = animated.get_frame_texture(0)
		print("frame0 class=", f0.get_class(), " size=", f0.get_size())
		if f0 is AtlasTexture:
			var atlas: AtlasTexture = f0
			print("atlas size=", atlas.atlas.get_size(), " region=", atlas.region, " filter_clip=", atlas.filter_clip)
		print("duration0=", animated.get_frame_duration(0))
	var image: Image = t.get_image()
	print("rendered size=", image.get_size())
	image.save_png("res://.local/preview/diag-texture.png")
	print("saved diag")
	quit()
