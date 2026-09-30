extends RefCounted
## Presentation-only file adapter. The rule core never sees these paths/textures.
var catalog: Dictionary = {}
var error := ""
var _textures: Dictionary = {}
var _previews: Dictionary = {}
var _fonts: Dictionary = {}

func reload() -> bool:
	error = ""
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://content/catalog.json"))
	if not valid_catalog(parsed):
		error = "素材表无法读取，请检查 content/catalog.json"
		return false
	catalog = parsed
	_textures.clear()
	_previews.clear()
	_fonts.clear()
	return true

func required_ui_assets() -> Array:
	var contract: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://content/ui_contract.json"))
	if not contract is Dictionary or not contract.get("required_ui_assets") is Array:
		return []
	return contract.required_ui_assets

func valid_catalog(value: Variant) -> bool:
	# Reject malformed hand-edited files before replacing the last usable catalog.
	if not value is Dictionary or value.get("schema_version") != 1:
		return false
	if not value.get("ui") is Dictionary or not value.get("theme") is Dictionary or not value.get("assets") is Array or not value.get("deck") is Array:
		return false
	if not value.get("playback") is Dictionary: return false
	var interval: Variant = value.playback.get("seconds_per_image")
	if not (interval is int or interval is float) or not is_finite(float(interval)) or interval < 0.25 or interval > 30:
		return false
	return _valid_ui(value.ui) and _valid_theme(value.theme) and _valid_font(value) and _valid_assets(value.assets) and _valid_deck(value)

func _valid_ui(ui: Dictionary) -> bool:
	for label in ui.values():
		if not label is String:
			return false
	return true

func _valid_theme(theme: Dictionary) -> bool:
	for color_value in theme.values():
		if not color_value is String or not Color.html_is_valid(color_value):
			return false
	return true

func _valid_font(value: Dictionary) -> bool:
	if value.has("font"):
		var font_value: Variant = value.font
		if not font_value is Dictionary or not font_value.get("families") is Array or font_value.families.is_empty():
			return false
		for family in font_value.families:
			if not family is String or family.strip_edges().is_empty():
				return false
		var base_size: Variant = font_value.get("size")
		if not (base_size is int or base_size is float) or float(base_size) < 12.0 or float(base_size) > 48.0:
			return false
		if font_value.has("roles"):
			var roles: Variant = font_value.roles
			if not roles is Dictionary:
				return false
			for role in roles:
				if role not in ["options", "vote", "score", "tile"]:
					return false
				if not roles[role] is String or roles[role].length() > 128:
					return false
	return true

func _valid_assets(assets: Array) -> bool:
	var required := required_ui_assets()
	if required.is_empty():
		return false
	var seen: Dictionary = {}
	var meme_count := 0
	for asset in assets:
		if not asset is Dictionary:
			return false
		for field in ["key", "kind", "path", "title"]:
			if not asset.get(field) is String:
				return false
		if asset.key.is_empty() or seen.has(asset.key) or asset.kind not in ["ui", "meme"]:
			return false
		if asset.key in required and asset.kind != "ui":
			return false
		if not valid_asset_path(asset.path):
			return false
		seen[asset.key] = true
		if asset.kind == "meme": meme_count += 1
		if not asset.get("keywords") is Array:
			return false
		if asset.kind == "meme" and asset.keywords.is_empty(): return false
		for keyword in asset.keywords:
			if not keyword is String:
				return false
			if asset.kind == "meme" and keyword.strip_edges().is_empty(): return false
	for key in required:
		if not seen.has(key): return false
	if meme_count == 0: return false
	return true

func _valid_deck(value: Dictionary) -> bool:
	for entry in value.deck:
		if not entry is Dictionary:
			return false
	if not value.get("deck_presets", []) is Array: return false
	var deck_ids: Dictionary = {}
	for preset in value.get("deck_presets", []):
		if not preset is Dictionary or not preset.get("id") is String or preset.id.is_empty() or deck_ids.has(preset.id) or not preset.get("title") is String or not preset.get("deck") is Array: return false
		if _expand_tiles(preset.deck).is_empty(): return false
		deck_ids[preset.id] = true
	return true

func valid_asset_path(path: String) -> bool:
	return path.begins_with("assets/") and ".." not in path.split("/") and "\\" not in path and path.get_extension().to_lower() in ["svg", "png", "jpg", "jpeg", "webp"]

func text(key: String) -> String:
	return str(catalog.get("ui", {}).get(key, key))

func color(key: String) -> Color:
	return Color(str(catalog.get("theme", {}).get(key, "#ffffff")))

func font(role: String = "default") -> SystemFont:
	if _fonts.has(role):
		return _fonts[role]
	var names := PackedStringArray()
	for family in _font_families(role):
		names.append(family)
	if names.is_empty():
		return null
	var system := SystemFont.new()
	system.font_names = names
	_fonts[role] = system
	return system

func _font_families(role: String) -> Array:
	var font_catalog: Variant = catalog.get("font", {})
	if not font_catalog is Dictionary:
		return []
	var result: Array = []
	if role != "default":
		var chosen: Variant = font_catalog.get("roles", {}).get(role, "")
		if chosen is String and not chosen.strip_edges().is_empty():
			result.append(chosen)
	for family in font_catalog.get("families", []):
		if family is String and not family.strip_edges().is_empty() and not result.has(family):
			result.append(family)
	return result

func font_size() -> int:
	var value: Variant = catalog.get("font", {}).get("size", 18)
	if value is int or value is float:
		return clampi(int(value), 12, 48)
	return 18

func texture(key: String) -> Texture2D:
	if _textures.has(key):
		return _textures[key]
	for asset in catalog.get("assets", []):
		if asset.key == key:
			var loaded := _animated_texture(asset)
			if loaded == null:
				loaded = _still_texture(asset)
			if loaded != null:
				_textures[key] = loaded
			return loaded
	return null

func preview_texture(key: String) -> Texture2D:
	# Cheap first-frame texture for long candidate lists; animation loads on demand.
	if _previews.has(key):
		return _previews[key]
	for asset in catalog.get("assets", []):
		if asset.key == key:
			var loaded := _preview_from_file(asset)
			if loaded == null:
				loaded = _still_texture(asset)
			if loaded != null:
				_previews[key] = loaded
			return loaded
	return null

func _preview_from_file(asset: Dictionary) -> Texture2D:
	var preview_path: String = "res://content/previews/" + str(asset.path).get_file().get_basename() + ".png"
	if not FileAccess.file_exists(preview_path):
		return null
	var picture := Image.new()
	if picture.load(ProjectSettings.globalize_path(preview_path)) != OK or picture.is_empty():
		return null
	return ImageTexture.create_from_image(picture)

func _still_texture(asset: Dictionary) -> Texture2D:
	var path: String = asset.path
	if not valid_asset_path(path) or not FileAccess.file_exists("res://" + path):
		return null
	var picture := Image.new()
	var result: int
	if path.get_extension().to_lower() == "svg":
		result = picture.load_svg_from_string(FileAccess.get_file_as_string("res://" + path))
	else:
		result = picture.load(ProjectSettings.globalize_path("res://" + path))
	if result != OK or picture.is_empty():
		return null
	return ImageTexture.create_from_image(picture)

func _animated_texture(asset: Dictionary) -> Texture2D:
	# Frame sheets live in content/sheets/ and size_hint carries "anim:frames x columns @ fps".
	var spec := _animation_spec(str(asset.get("size_hint", "")))
	if spec.is_empty():
		return null
	var sheet_path: String = "res://content/sheets/" + str(asset.path).get_file().get_basename() + ".png"
	if not FileAccess.file_exists(sheet_path):
		return null
	var sheet := Image.new()
	if sheet.load(ProjectSettings.globalize_path(sheet_path)) != OK or sheet.is_empty():
		return null
	var frames: int = spec.frames
	var columns: int = spec.columns
	var rows := int(ceil(float(frames) / float(columns)))
	if sheet.get_width() % columns != 0 or sheet.get_height() % rows != 0:
		return null
	var frame_size := Vector2i(sheet.get_width() / columns, sheet.get_height() / rows)
	var frame_seconds: float = 1.0 / float(spec.fps)
	var animation := AnimatedTexture.new()
	animation.frames = frames
	for index in range(frames):
		var x := (index % columns) * frame_size.x
		var y := int(floor(index / float(columns))) * frame_size.y
		var frame_image := sheet.get_region(Rect2i(x, y, frame_size.x, frame_size.y))
		frame_image.compress(Image.COMPRESS_S3TC)
		animation.set_frame_texture(index, ImageTexture.create_from_image(frame_image))
		animation.set_frame_duration(index, frame_seconds)
	return animation

func _animation_spec(hint: String) -> Dictionary:
	var regex := RegEx.new()
	regex.compile("^anim:(\\d+)x(\\d+)@([0-9.]+)")
	var found := regex.search(hint.strip_edges())
	if found == null:
		return {}
	var frames := int(found.get_string(1))
	var columns := int(found.get_string(2))
	var fps := float(found.get_string(3))
	if frames < 2 or columns < 1 or fps <= 0.0:
		return {}
	return {"frames": frames, "columns": columns, "fps": fps}

func meme_assets(query: String = "", glyphs: Array = []) -> Array:
	return preload("res://presentation/meme_search.gd").rank(catalog.get("assets", []), query, glyphs)

func tiles(preset_id: String = "") -> Array:
	if preset_id.is_empty(): return _expand_tiles(catalog.get("deck", []))
	for preset in catalog.get("deck_presets", []):
		if preset.id == preset_id: return _expand_tiles(preset.deck)
	return []

func _expand_tiles(entries: Array) -> Array:
	var result: Array = []
	for entry in entries:
		if not entry is Dictionary: return []
		if not entry.get("glyph") is String or entry.glyph.length() != 1 or not entry.get("copies") is float and not entry.get("copies") is int:
			return []
		if entry.copies != floor(entry.copies) or entry.copies < 0 or entry.copies > 136:
			return []
		for index in range(int(entry.copies)):
			result.append({"id": "tile_%03d" % result.size(), "glyph": entry.glyph})
	return result if result.size() == 136 else []
