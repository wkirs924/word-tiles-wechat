extends SceneTree
const Core = preload("res://tests/test_core.gd")
const Local = preload("res://tests/test_local_table.gd")

func _initialize() -> void:
	var result: Dictionary = Core.new().run()
	var local := Local.new()
	var finished := local.run()
	result.checks += local.checks + 1
	result.failures += local.failures + (0 if finished else 1)
	var search := preload("res://tests/test_meme_search.gd").new()
	var search_finished := search.run()
	result.checks += search.checks + 1
	result.failures += search.failures + (0 if search_finished else 1)
	print("RESULT: %d checks, %d failures" % [result.checks, result.failures])
	quit(0 if result.failures == 0 else 1)
