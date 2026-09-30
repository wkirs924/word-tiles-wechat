extends SceneTree
const Suite = preload("res://tests/test_core.gd")
const LocalSuite = preload("res://tests/test_local_table.gd")
const PresentationSuite = preload("res://tests/test_presentation.gd")

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var suite := Suite.new()
	var result: Dictionary = suite.run()
	var local_suite := LocalSuite.new()
	var finished := local_suite.run()
	result.checks += local_suite.checks + 1
	result.failures += local_suite.failures + (0 if finished else 1)
	var ui_suite := PresentationSuite.new()
	var ui_finished: bool = await ui_suite.run(self)
	result.checks += ui_suite.checks + 1
	result.failures += ui_suite.failures + (0 if ui_finished else 1)
	var controller := preload("res://tests/test_game_controller.gd").new()
	var controller_finished: bool = controller.run()
	result.checks += controller.checks + 1
	result.failures += controller.failures + (0 if controller_finished else 1)
	var search := preload("res://tests/test_meme_search.gd").new()
	var search_finished := search.run()
	result.checks += search.checks + 1
	result.failures += search.failures + (0 if search_finished else 1)
	var motion := preload("res://tests/test_ui_motion.gd").new()
	var motion_finished: bool = await motion.run(self)
	result.checks += motion.checks + 1
	result.failures += motion.failures + (0 if motion_finished else 1)
	print("RESULT: %d checks, %d failures" % [result.checks, result.failures])
	quit(0 if result.failures == 0 else 1)
