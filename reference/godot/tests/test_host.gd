extends RefCounted
const Host = preload("res://application/local_host.gd")
const Data = preload("res://core/json_data.gd")

static func run() -> Array:
	var errors: Array = []
	var host := Host.new()
	if host.initialize("host-test", ["a", "b", "c", "d"], "a").get("ok") != true:
		errors.append("Host initialization failed")
	var tiles: Array = []
	for index in range(136):
		tiles.append({"id": "tile_" + str(index), "glyph": "字"})
	var command := {"command_id": "start", "type": "START_NEXT_ROUND", "payload": {"round_id": "r1", "tiles": tiles, "seed": 99}}
	var result := host.submit(command, "a")
	if not result.receipt.ok or result.deliveries.size() != 4:
		errors.append("Host did not produce four addressed deliveries")
	for player in ["a", "b", "c", "d"]:
		var view: Dictionary = result.deliveries[player].view
		if view.viewer_id != player or view.round.has("wall") or view.round.has("catalog"):
			errors.append("Host view contains secrets or wrong identity")
		if Data.canonical(host.reconnect(player)) != Data.canonical(view):
			errors.append("Reconnect does not replace view from authoritative state")
	if not host.submit(command, "a").deliveries.is_empty():
		errors.append("Duplicate command was broadcast again")
	if host.export_host_replay("b").ok or host.reconnect("stranger").ok:
		errors.append("Untrusted caller obtained private state")
	if not host.export_host_replay("a").ok:
		errors.append("Trusted host cannot export replay")
	return errors
