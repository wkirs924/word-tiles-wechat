extends SceneTree

# Build-time helper: rasterize static SVGs from the pinned original assets into PNG.
# Usage:
#   godot_console --headless --path <tmp-project> --script res://rasterize_svg.gd \
#     -- --input <dir> --output <dir> [--scale 2]
# It never imports the SVGs as Godot resources, so no .import side files are written.

func _parse_args() -> Dictionary:
	var args := OS.get_cmdline_user_args()
	var parsed := {"input": "", "output": "", "scale": 1.0}
	var index := 0
	while index < args.size():
		var key := args[index]
		var value := args[index + 1] if index + 1 < args.size() else ""
		match key:
			"--input":
				parsed.input = value
			"--output":
				parsed.output = value
			"--scale":
				parsed.scale = float(value)
		index += 2
	return parsed

func _init() -> void:
	var args := _parse_args()
	var input_dir := String(args.input)
	var output_dir := String(args.output)
	var scale := float(args.scale)
	if input_dir.is_empty() or output_dir.is_empty():
		push_error("rasterize_svg: --input and --output are required")
		quit(2)
		return
	DirAccess.make_dir_recursive_absolute(output_dir)
	var dir := DirAccess.open(input_dir)
	if dir == null:
		push_error("rasterize_svg: cannot open input directory " + input_dir)
		quit(2)
		return
	var failures := 0
	var written := 0
	for file_name in dir.get_files():
		if not file_name.to_lower().ends_with(".svg"):
			continue
		var svg := FileAccess.get_file_as_string(input_dir.path_join(file_name))
		if svg.is_empty():
			push_error("rasterize_svg: cannot read " + file_name)
			failures += 1
			continue
		var image := Image.new()
		var error := image.load_svg_from_string(svg, scale)
		if error != OK:
			push_error("rasterize_svg: failed to rasterize %s (error %d)" % [file_name, error])
			failures += 1
			continue
		var out_name := file_name.substr(0, file_name.length() - 4) + ".png"
		var save_error := image.save_png(output_dir.path_join(out_name))
		if save_error != OK:
			push_error("rasterize_svg: cannot save " + out_name)
			failures += 1
			continue
		written += 1
	print("rasterize_svg: wrote %d file(s), %d failure(s)" % [written, failures])
	quit(1 if failures > 0 else 0)
