extends SceneTree
## Focused refactor loop. The full release gate remains tests/run_tests.gd.

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var checks := 0
	var failures := 0
	var controller := preload("res://tests/test_game_controller.gd").new()
	var controller_finished: bool = controller.run()
	checks += controller.checks + 1
	failures += controller.failures + (0 if controller_finished else 1)
	for suite in [preload("res://tests/test_presentation.gd").new(), preload("res://tests/test_ui_motion.gd").new()]:
		var finished: bool = await suite.run(self)
		checks += suite.checks + 1
		failures += suite.failures + (0 if finished else 1)
	print("RESULT: %d checks, %d failures" % [checks, failures])
	quit(0 if failures == 0 else 1)
