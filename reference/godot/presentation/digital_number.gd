extends Control
## Original segmented LED numerals. Vector cells remain sharp at any resolution.
const SEGMENTS := ["abcdef", "bc", "abdeg", "abcdg", "bcfg", "acdfg", "acdefg", "abc", "abcdefg", "abcdfg"]
var value := "0"
var ink := Color("80ffb0")

func setup(text: String, height: float = 32.0, color: Color = Color("80ffb0")) -> void:
	value = text.replace("−", "-")
	ink = color
	custom_minimum_size = Vector2(maxf(_units() * height, height * 0.6), height)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	tooltip_text = text
	resized.connect(queue_redraw)
	queue_redraw()

func _units() -> float:
	var width := 0.0
	for character in value: width += 0.24 if character == "." else 0.67
	return width

func _draw() -> void:
	var h := minf(size.y - 6, (size.x - 6) / maxf(_units(), 0.1))
	var origin := Vector2((size.x - _units() * h) / 2, (size.y - h) / 2)
	for character in value:
		if character == ".":
			_cell(Rect2(origin + Vector2(0.05, 0.88) * h, Vector2(0.09, 0.09) * h))
			origin.x += 0.24 * h
			continue
		var active: String = "g" if character == "-" else (SEGMENTS[int(character)] if character.is_valid_int() else "")
		# The 7-segment '1' only lights its right side. Center those lit cells
		# within the regular digit slot without changing inter-digit spacing.
		var digit_origin := origin - Vector2(.25 * h, 0) if character == "1" else origin
		for segment in active:
			var horizontal: bool = segment in "adg"
			var start: Vector2 = {"a": Vector2(.09, 0), "b": Vector2(.5, .09), "c": Vector2(.5, .55), "d": Vector2(.09, .91), "e": Vector2(0, .55), "f": Vector2(0, .09), "g": Vector2(.09, .455)}[segment]
			for index in range(4):
				var step := Vector2(index * .1, 0) if horizontal else Vector2(0, index * .09)
				_cell(Rect2(digit_origin + (start + step) * h, Vector2(.082, .073) * h))
		origin.x += .67 * h

func _cell(rect: Rect2) -> void:
	draw_rect(rect.grow(3), Color(ink, .06))
	draw_rect(rect.grow(1.4), Color(ink, .22))
	draw_rect(rect, ink)
	draw_rect(rect.grow(-rect.size.x * .12), ink.lightened(.75))
