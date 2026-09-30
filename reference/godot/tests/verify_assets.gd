extends SceneTree
## Throwaway verification: every meme asset must load, animated ones as AnimatedTexture.
const Content = preload("res://presentation/content_store.gd")

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var content: RefCounted = Content.new()
	if not content.reload():
		print("RELOAD FAILED: ", content.error)
		quit(1)
		return
	var animated := 0
	var still := 0
	var failed: Array = []
	var started := Time.get_ticks_msec()
	for asset in content.catalog.assets:
		if asset.kind != "meme":
			continue
		var loaded: Texture2D = content.texture(asset.key)
		if loaded == null:
			failed.append(asset.key + " | " + asset.title)
			continue
		if loaded is AnimatedTexture:
			animated += 1
		else:
			still += 1
	print("elapsed_ms=", Time.get_ticks_msec() - started)
	print("VERIFY memes=", content.catalog.assets.size(), " animated=", animated, " still=", still, " failed=", failed.size())
	for item in failed:
		print("FAILED: ", item)
	for preset in content.catalog.deck_presets:
		var tiles: Array = content.tiles(preset.id)
		print("PRESET ", preset.id, " ", preset.title, " tiles=", tiles.size())
	quit(0 if failed.is_empty() else 1)
