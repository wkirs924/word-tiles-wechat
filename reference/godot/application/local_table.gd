extends RefCounted
const Host = preload("res://application/local_host.gd")
## Trusted hot-seat controller. UI receives one view, never the host's delivery map.
## Handoff state is presentation/session state, not part of game rules or replay.
var _host := Host.new()
var _viewer := ""
var _pending_viewer := ""

func initialize(session_id: String, players: Array, host_id: String, config: Dictionary = {}) -> Dictionary:
	return _host.initialize(session_id, players, host_id, config)

func begin_handoff(player_id: String) -> Dictionary:
	# Always clear the old identity first, including when the requested seat is invalid.
	_viewer = ""
	_pending_viewer = ""
	var view := _host.reconnect(player_id)
	if not view.ok:
		return {"ok": false, "error": view.error, "screen": "HANDOFF", "view": null, "events": []}
	_pending_viewer = player_id
	return {"ok": true, "screen": "HANDOFF", "next_player_id": player_id, "view": null, "events": []}

func confirm_handoff() -> Dictionary:
	if _pending_viewer.is_empty():
		return _failure("NO_PENDING_HANDOFF")
	_viewer = _pending_viewer
	_pending_viewer = ""
	return current()

func current() -> Dictionary:
	if _viewer.is_empty():
		return {"ok": true, "screen": "HANDOFF", "view": null, "events": []}
	return {"ok": true, "screen": "PLAYER", "view": _host.reconnect(_viewer), "events": []}

func submit(command: Variant) -> Dictionary:
	if _viewer.is_empty():
		return _failure("HANDOFF_REQUIRED")
	# Identity is bound to the confirmed seat, never accepted from the command.
	var result := _host.submit(command, _viewer)
	var visible_events: Array = []
	if result.deliveries.has(_viewer):
		visible_events = result.deliveries[_viewer].events
	return {"ok": result.receipt.ok, "screen": "PLAYER", "receipt": result.receipt,
		"view": _host.reconnect(_viewer), "events": visible_events}

func cover() -> Dictionary:
	_viewer = ""
	_pending_viewer = ""
	return current()

func _failure(error: String) -> Dictionary:
	return {"ok": false, "error": error, "screen": "HANDOFF", "view": null, "events": []}
