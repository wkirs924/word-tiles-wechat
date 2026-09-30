extends SceneTree
const Content = preload("res://presentation/content_store.gd")

func _initialize() -> void:
	call_deferred("capture")

func capture() -> void:
	root.size = Vector2i(1200, 720)
	var content := Content.new()
	if not content.reload(): quit(1); return
	var grid := GridContainer.new()
	grid.columns = 6
	var theme := Theme.new()
	var font := SystemFont.new()
	font.font_names = PackedStringArray(["Microsoft YaHei", "Noto Sans CJK SC"])
	theme.default_font = font
	theme.default_font_size = 16
	grid.theme = theme
	root.add_child(grid)
	for asset in content.catalog.assets:
		if not asset.key.begins_with("meme.nba."): continue
		var box := VBoxContainer.new()
		box.custom_minimum_size = Vector2(196, 174)
		grid.add_child(box)
		var picture := TextureRect.new()
		picture.texture = content.texture(asset.key)
		picture.custom_minimum_size = Vector2(196, 118)
		picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		box.add_child(picture)
		var title := Label.new()
		title.text = asset.title
		title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		box.add_child(title)
		var tags := Label.new()
		tags.text = " / ".join(asset.keywords)
		tags.add_theme_font_size_override("font_size", 10)
		tags.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		box.add_child(tags)
	await process_frame
	await process_frame
	await RenderingServer.frame_post_draw
	DirAccess.make_dir_recursive_absolute("res://.local/preview")
	var result := root.get_texture().get_image().save_png("res://.local/preview/basketball-pack.png")
	print("BASKETBALL_PREVIEW: ", result)
	quit(result)
