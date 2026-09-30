extends RefCounted
## JSON boundary utilities. No IO, clocks, random globals or engine services.

static func is_integer(value: Variant) -> bool:
	return (typeof(value) == TYPE_INT and value >= -9007199254740991 and value <= 9007199254740991) or (typeof(value) == TYPE_FLOAT and is_finite(value) and value == floor(value) and abs(value) <= 9007199254740991.0)

static func is_json(value: Variant, depth: int = 0) -> bool:
	if depth > 32:
		return false
	match typeof(value):
		TYPE_NIL, TYPE_BOOL, TYPE_STRING:
			return true
		TYPE_INT:
			# abs(INT64_MIN) overflows; compare against both endpoints instead.
			return value >= -9007199254740991 and value <= 9007199254740991
		TYPE_FLOAT:
			return is_finite(value) and abs(value) <= 9007199254740991.0
		TYPE_ARRAY:
			for item in value:
				if not is_json(item, depth + 1):
					return false
			return true
		TYPE_DICTIONARY:
			for key in value:
				if not key is String or not is_json(value[key], depth + 1):
					return false
			return true
	return false

static func canonical(value: Variant) -> String:
	match typeof(value):
		TYPE_DICTIONARY:
			var keys: Array = value.keys()
			keys.sort()
			var entries: PackedStringArray = []
			for key in keys:
				entries.append(JSON.stringify(key) + ":" + canonical(value[key]))
			return "{" + ",".join(entries) + "}"
		TYPE_ARRAY:
			var entries: PackedStringArray = []
			for item in value:
				entries.append(canonical(item))
			return "[" + ",".join(entries) + "]"
		TYPE_FLOAT:
			if is_integer(value):
				return str(int(value))
	return JSON.stringify(value)

static func identifier(value: Variant, max_length: int = 128) -> bool:
	return value is String and not value.is_empty() and value.length() <= max_length

static func only_keys(value: Dictionary, allowed: Array) -> bool:
	for key in value:
		if key not in allowed:
			return false
	return true
