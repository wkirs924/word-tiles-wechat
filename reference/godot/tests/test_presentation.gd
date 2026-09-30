extends RefCounted
const Main = preload("res://presentation/main.gd")
const Content = preload("res://presentation/content_store.gd")
var checks := 0
var failures := 0
var app: Control

func check(value: bool, message: String) -> void:
	checks += 1
	if not value:
		failures += 1
		push_error("FAIL: UI " + message)

func click(text: String) -> void:
	var button := find_button(app, text)
	check(button != null and not button.disabled, "button enabled: " + text)
	if button != null and not button.disabled:
		button.pressed.emit()

func find_button(node: Node, text: String) -> Button:
	if node is Button and node.text == text:
		return node
	for child in node.get_children():
		var found := find_button(child, text)
		if found != null:
			return found
	return null

func meme_card(node: Node, key: String) -> Button:
	if node is Button and node.get_meta("meme_key", "") == key:
		return node
	for child in node.get_children():
		var found := meme_card(child, key)
		if found != null:
			return found
	return null

func tile_buttons(node: Node) -> Array:
	var found: Array = []
	if node.has_meta("tile_id"):
		found.append(node)
	for child in node.get_children():
		found.append_array(tile_buttons(child))
	return found

func count_metadata(node: Node, key: String) -> int:
	var count := 1 if node.has_meta(key) else 0
	for child in node.get_children(): count += count_metadata(child, key)
	return count

func asset_sizes_match(node: Node) -> bool:
	if node.has_meta("display_size") and node.size != node.get_meta("display_size"):
		return false
	for child in node.get_children():
		if not asset_sizes_match(child): return false
	return true

func take(player: String) -> void:
	app.controller.choose_seat(player)
	check(app.controller.current_view().is_empty(), "handoff clears cached projection")
	check(app.controller.selected_tiles().is_empty(), "handoff clears selection")
	check(app.controller.selected_memes().is_empty(), "handoff clears meme draft")
	check(tile_buttons(app).is_empty(), "old tile widgets detached immediately")
	click("我已接手 · 查看手牌")
	check(app.controller.current_view().viewer_id == player, "correct player view after confirmation")

func run(tree: SceneTree) -> bool:
	print("TEST M3/M4 presentation: menu/handoff/cards/votes/memes/ratings/reload")
	var content := Content.new()
	check(content.reload(), "catalog readable")
	for invalid in [null, {"schema_version": 1}, {"schema_version": 1, "ui": [], "theme": {}, "assets": [], "deck": []}]:
		check(not content.valid_catalog(invalid), "malformed manual catalog rejected")
	var bad_asset: Dictionary = content.catalog.duplicate(true)
	bad_asset.assets[0].keywords = [3]
	check(not content.valid_catalog(bad_asset), "invalid keyword type rejected before replacing catalog")
	var bad_font: Dictionary = content.catalog.duplicate(true)
	bad_font.font.roles.vote = 7
	check(not content.valid_catalog(bad_font), "malformed font role still rejected after validator extraction")
	for invalid_keywords in [[], [" "], [3]]:
		var invalid_meme: Dictionary = content.catalog.duplicate(true)
		for asset in invalid_meme.assets:
			if asset.kind == "meme": asset.keywords = invalid_keywords
		check(not content.valid_catalog(invalid_meme), "memes require nonempty keyword labels")
	for required_key in content.required_ui_assets():
		var missing: Dictionary = content.catalog.duplicate(true)
		missing.assets = missing.assets.filter(func(asset): return asset.key != required_key)
		check(not content.valid_catalog(missing), "required UI mapping cannot disappear: " + required_key)
	var duplicated: Dictionary = content.catalog.duplicate(true)
	duplicated.assets.append(duplicated.assets[0].duplicate(true))
	check(not content.valid_catalog(duplicated), "duplicate mappings rejected")
	var invalid_path: Dictionary = content.catalog.duplicate(true)
	invalid_path.assets[0].path = "assets/../content/catalog.json"
	check(not content.valid_catalog(invalid_path), "mapping cannot escape image directory")
	var remapped := Content.new()
	check(remapped.reload(), "remapping fixture loads")
	remapped.catalog.assets[0].path = "assets/ui/tile.svg"
	check(remapped.texture("ui.background").get_size() == Vector2(120, 160), "resource key resolves changed path, not hardcoded image")
	check(content.tiles().size() == 136, "demo deck exactly 136")
	check(not content.meme_assets("开心").is_empty(), "keyword search allows added content")
	check(not content.catalog.ui.has("meme_order_hint"), "retired image-picker hint is absent from catalog")
	check(not content.catalog.ui.has("decision_hint"), "retired voting hint is absent from catalog")
	for sharp_key in ["meme.gs.029", "meme.gs.032"]:
		var sharp_preview: Texture2D = content.preview_texture(sharp_key)
		var sharp_animation: Texture2D = content.texture(sharp_key)
		check(sharp_preview != null and sharp_preview.get_size() == Vector2(200, 433), "dance meme preview keeps source resolution: " + sharp_key)
		check(sharp_animation != null and sharp_animation.get_size().x >= 200 and sharp_animation.get_size().y >= 433, "dance meme animation keeps source resolution: " + sharp_key)
	for preset in content.catalog.get("deck_presets", []):
		check(content.tiles(preset.id).size() == 136, "preset expands to exactly 136 tiles: " + preset.id)
	var nba_presets: Array = content.catalog.get("deck_presets", [])
	check(nba_presets.size() == 2 and nba_presets[0].id == "nba.words" and nba_presets[0].title == "NBA" and nba_presets[1].id == "lol.words", "menu keeps only NBA and 英雄联盟 presets")
	var nba_entries: Array = nba_presets[0].deck
	var nba_copies: Dictionary = {}
	for entry in nba_entries:
		nba_copies[entry.glyph] = entry.copies
	check(nba_entries.size() == 68 and nba_copies.size() == 68, "NBA deck keeps 68 unique characters")
	for glyph in ["詹", "姆", "斯"]:
		check(nba_copies.get(glyph) == 2, "NBA name character has exactly two copies: " + glyph)
	check(nba_copies.values().all(func(copies): return copies == 2), "every NBA character has two copies")
	var lol_entries: Array = nba_presets[1].deck
	var lol_copies: Dictionary = {}
	for entry in lol_entries:
		lol_copies[entry.glyph] = entry.copies
	check(lol_entries.size() == 68 and lol_copies.size() == 68, "League deck keeps 68 unique characters")
	check(lol_copies.values().all(func(copies): return copies == 2), "every League character has two copies")
	for preset_index in range(2):
		var glyphs: Dictionary = nba_copies if preset_index == 0 else lol_copies
		var reachable := 0
		var expected := 39 if preset_index == 0 else 50
		for asset in content.catalog.assets:
			if not asset.key.begins_with("meme.gs."):
				continue
			var number := int(asset.key.get_slice(".", 2))
			if number >= 61 and number <= 75 or preset_index == 0 and number >= 37 and number <= 60 or preset_index == 1 and number >= 1 and number <= 36:
				for keyword in asset.keywords:
					var complete := true
					for glyph in keyword:
						if not glyphs.has(glyph): complete = false
					if complete:
						reachable += 1
						break
		check(reachable == expected, "all relevant memes retain a complete keyword: " + str(preset_index))
	for asset in content.catalog.assets:
		if asset.key in ["meme.gs.014", "meme.gs.015", "meme.gs.022", "meme.gs.029", "meme.gs.037", "meme.gs.046", "meme.gs.049", "meme.gs.066"]:
			check(asset.keywords.has("开心") and asset.keywords.has("高兴") and not asset.keywords.has("愉悦"), "happy images share two canonical search labels: " + asset.key)
	check(lol_copies.has("高") and lol_copies.has("兴") and lol_copies.has("开") and lol_copies.has("心"), "League deck can compose both happy synonyms")
	check(content.tiles("missing-preset").is_empty(), "unknown preset does not silently choose another deck")
	for asset in content.catalog.assets:
		check(content.texture(asset.key) != null, "image loads without editor import: " + asset.key)
	app = Main.new()
	tree.root.add_child(app)
	await tree.process_frame
	var deck_choice := app.find_child("DeckPreset", true, false) as OptionButton
	check(deck_choice != null and deck_choice.item_count == 2 and deck_choice.get_item_metadata(0) == "nba.words" and deck_choice.get_item_metadata(1) == "lol.words", "menu offers only NBA and 英雄联盟 decks")
	deck_choice.select(0)
	deck_choice.item_selected.emit(0)
	click("开始四人试玩")
	check(app.controller.current_view().is_empty(), "new game starts covered")
	click("我已接手 · 查看手牌")
	click("开始四人试玩")
	var dealer: String = app.controller.current_view().round.dealer_id
	take(dealer)
	var expected_glyphs: Array = []
	for tile in content.tiles("nba.words"): expected_glyphs.append(tile.glyph)
	for tile in app.controller.current_view().round.hand:
		check(tile.glyph in expected_glyphs, "chosen preset supplies actual round tiles")
	check(tile_buttons(app).size() == 14, "dealer sees 14 clickable cards")
	check(count_metadata(app, "hidden_card") == 39, "opponents render exactly 39 backs, never physical tile IDs")
	check(count_metadata(app, "seat_id") == 4, "all four table seats are reachable")
	check(asset_sizes_match(app), "table textures use layout sizes instead of source image sizes")
	var selection_revision: int = app.controller.current_view().revision
	var before_y: float = tile_buttons(app)[0].position.y
	tile_buttons(app)[0].pressed.emit()
	check(tile_buttons(app)[0].position.y < before_y, "selected tile rises above hand")
	check(app.controller.selected_tiles().size() == 1 and app.controller.current_view().revision == selection_revision, "table selection is presentation only")
	check(app.find_child("MemeSearch", true, false) != null, "selecting a tile opens the meme composer automatically")
	tile_buttons(app)[0].pressed.emit()
	check(app.controller.selected_tiles().is_empty(), "clicking raised tile clears selection")
	var search := app.find_child("MemeSearch", true, false) as LineEdit
	check(search != null, "inline meme search field present")
	var happy_query := ""
	for asset in content.catalog.assets:
		if asset.key == "meme.gs.066": happy_query = asset.keywords[0]
	search.text = happy_query
	search.text_changed.emit(happy_query)
	var happy_card := meme_card(app, "meme.gs.066")
	check(happy_card != null, "meme card itself is clickable")
	if happy_card != null:
		var picture: TextureRect = null
		var caption_count := 0
		for child in happy_card.get_children():
			if child is Label: caption_count += 1
			if child is TextureRect: picture = child
		check(caption_count == 0, "image-only meme card has no duplicate caption")
		check(picture != null and happy_card.custom_minimum_size == Vector2(156, 116) and picture.position == Vector2(4, 4) and picture.size == Vector2(148, 108), "larger meme card keeps a tight four-pixel image inset")
		check(happy_card.tooltip_text.contains("开心"), "full keywords remain available in the tooltip")
		happy_card.pressed.emit()
	check(app.controller.selected_memes() == ["meme.gs.066"], "clicking a card selects the image without submitting")
	check(app.controller.current_view().revision == selection_revision, "meme draft does not advance core")
	search = app.find_child("MemeSearch", true, false) as LineEdit
	check(search.text == happy_query, "search survives selecting a candidate")
	search.text = ""
	search.text_changed.emit("")
	await tree.process_frame
	await tree.process_frame
	var candidates := app.find_child("MemeCandidates", true, false) as ScrollContainer
	candidates.scroll_vertical = int(candidates.get_v_scroll_bar().max_value)
	var saved_scroll := candidates.scroll_vertical
	check(saved_scroll > 0, "candidate list is genuinely scrollable")
	app.controller.toggle_meme("meme.gs.038")
	await tree.process_frame
	await tree.process_frame
	candidates = app.find_child("MemeCandidates", true, false) as ScrollContainer
	check(candidates.scroll_vertical == saved_scroll, "candidate scroll survives selection rerender")
	app.controller.toggle_meme("meme.gs.038")
	app.controller.toggle_meme("meme.gs.038")
	check(app.controller.selected_memes() == ["meme.gs.066", "meme.gs.038"], "removed image re-appends at end")
	app.controller.move_meme("meme.gs.038", -1)
	check(app.controller.selected_memes() == ["meme.gs.038", "meme.gs.066"], "move image earlier changes draft order")
	app.controller.reorder_meme("meme.gs.066", 0)
	check(app.controller.selected_memes() == ["meme.gs.066", "meme.gs.038"], "drag target changes draft order")
	app.controller.reorder_meme("meme.gs.066", 99)
	check(app.controller.selected_memes() == ["meme.gs.066", "meme.gs.038"], "invalid drop target ignored")
	check(app.controller.current_view().revision == selection_revision, "reordering never dispatches a rule command")
	await tree.process_frame
	check(asset_sizes_match(app), "meme thumbnails remain inside their display bounds")
	var selected_card := meme_card(app, "meme.gs.066")
	check(selected_card != null and selected_card.has_node("SelectionBadge"), "selection order has a dedicated badge")
	var hand: Array = app.controller.current_view().round.hand
	for tile in hand: app.controller.select_tile(tile.id)
	app.controller.reorder_tile(hand[0].id, hand.size() - 1)
	check(app.controller.selected_tiles()[-1] == hand[0].id, "word draft moves to dropped position")
	app.controller.reorder_tile(hand[0].id, 0)
	var ordered: Array = app.controller.selected_tiles()
	app.skip_animation()
	await tree.process_frame
	await tree.process_frame
	check(app.controller.selected_tiles() == ordered and app.controller.current_view().revision == selection_revision, "skipping pending transitions leaves drafts and authority intact")
	click("出牌")
	check(app.controller.current_view().round.pending_sentence.resource_keys == ["meme.gs.066", "meme.gs.038"], "出牌 submits tiles and ordered images together")
	var slideshow = app.find_child("ProposalMemePlayer", true, false)
	check(slideshow != null, "voting page contains slideshow")
	var playback_revision: int = app.controller.current_view().revision
	if slideshow != null:
		check(slideshow.current_resource_key() == "meme.gs.066", "playback starts at first image")
		await slideshow.get_node("MemeTimer").timeout
		check(slideshow.current_resource_key() == "meme.gs.038", "actual timer follows selection order")
		slideshow.next_image()
		check(slideshow.current_resource_key() == "meme.gs.066", "playback loops")
		slideshow.toggle_pause()
		slideshow.previous_image()
		check(slideshow.current_resource_key() == "meme.gs.038", "manual previous while paused")
	check(app.controller.current_view().revision == playback_revision, "playback never mutates authority")
	for player in ["东", "南", "西", "北"]:
		if player != dealer:
			take(player)
			check(find_button(app, "3") == null, "decision precedes rating")
			var decision_heading := app.find_child("DecisionTitle", true, false) as Label
			var decision_actions := app.find_child("DecisionActions", true, false) as HBoxContainer
			var approve_button := find_button(app, "认可")
			var oppose_button := find_button(app, "反对")
			check(decision_heading != null and decision_heading.horizontal_alignment == HORIZONTAL_ALIGNMENT_CENTER, "decision heading is centered")
			check(decision_actions != null and approve_button != null and oppose_button != null and decision_actions.alignment == BoxContainer.ALIGNMENT_CENTER and approve_button.custom_minimum_size == Vector2(132, 46) and oppose_button.custom_minimum_size == Vector2(132, 46), "decision buttons are compact and centered")
			click("认可")
			check(app.controller.current_view().revision == playback_revision, "decision remains private draft until score")
			click("返回修改判断")
			check(find_button(app, "3") == null, "back restores decision step")
			click("认可")
			click("3")
			playback_revision = app.controller.current_view().revision
	check(app.controller.current_view().round.phase == "COMPLETED", "last ballot settles immediately without end memes")
	check(app.controller.current_view().ranking[0].total.numerator == 60, "core computes 17 + 3 exactly")
	take("东")
	click("开始下一局")
	check(app.controller.current_view().round_number == 2, "UI next round")
	var revision: int = app.controller.current_view().revision
	app.reload_content()
	app.skip_animation()
	check(app.controller.current_view().revision == revision, "resource reload and animation skip do not mutate game")
	var active: String = app.controller.current_view().round.active_player_id
	take(active)
	var cards: Array = app.controller.current_view().round.hand
	app.controller.select_tile(cards[0].id)
	search = app.find_child("MemeSearch", true, false) as LineEdit
	check(search.text.is_empty(), "handoff and new round clear previous search")
	click("出牌")
	active = app.controller.current_view().round.active_player_id
	take(active)
	click("摸牌")
	cards = app.controller.current_view().round.hand
	app.controller.select_tile(cards[0].id)
	app.controller.select_tile(cards[1].id)
	click("出牌")
	for player in ["东", "南", "西", "北"]:
		if player != active:
			take(player)
			check(find_button(app, "0") == null, "no-image proposal has no rating step")
			click("反对")
	take(active)
	check(app.controller.current_view().round.phase == "MUST_DISCARD", "rejection UI uses core forced-discard phase")
	check(find_button(app, "提交句子") == null, "composer closes after rejection")
	var play_button := find_button(app, "出牌")
	check(play_button != null and play_button.disabled, "cannot resubmit after rejection")
	app.controller.select_tile(app.controller.current_view().round.hand[0].id)
	click("出牌")
	app.queue_free()
	await tree.process_frame
	return true
