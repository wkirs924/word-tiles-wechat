extends RefCounted
const Session = preload("res://application/session_reducer.gd")
const PlayerView = preload("res://projection/player_projection.gd")
## Trusted application facade. UI receives only projections and sanitized receipts.
## Its caller supplies the identity from a trusted local seat/transport mapping.
var _state: Dictionary = {}

func initialize(session_id: String, players: Array, host_player_id: String, config: Dictionary = {}) -> Dictionary:
	if not _state.is_empty():
		return {"ok": false, "error": "ALREADY_INITIALIZED"}
	var created := Session.create(session_id, players, host_player_id, config)
	if not created.ok:
		return created
	_state = created.state
	return {"ok": true}

func submit(command: Variant, trusted_player_id: String) -> Dictionary:
	if _state.is_empty():
		return {"receipt": {"ok": false, "error": "NOT_INITIALIZED"}, "deliveries": {}}
	var result := Session.reduce(_state, command, trusted_player_id)
	_state = result.state
	var deliveries: Dictionary = {}
	if result.receipt.ok and not result["duplicate"]:
		for player in _state.players:
			deliveries[player] = PlayerView.delivery(_state, result, player)
	# The map is host-only: transport must send each entry solely to its bound peer.
	return {"receipt": result.receipt.duplicate(true), "duplicate": result["duplicate"], "deliveries": deliveries}

func reconnect(trusted_player_id: String) -> Dictionary:
	if _state.is_empty():
		return {"ok": false, "error": "NOT_INITIALIZED"}
	return PlayerView.view(_state, trusted_player_id)

func export_host_replay(trusted_player_id: String) -> Dictionary:
	if _state.is_empty() or trusted_player_id != _state.host_player_id:
		return {"ok": false, "error": "HOST_REQUIRED"}
	return {"ok": true, "replay": Session.export_replay(_state)}
