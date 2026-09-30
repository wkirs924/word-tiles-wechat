"""Encode animation frames once from original GIFs, with bounded decoded size."""
from pathlib import Path
from PIL import Image
import math


def encode_animation(source: Path, destination: Path, max_edge=288, max_frames=32, fps=12, quality=72,
                     max_decoded_bytes=10 * 1024 * 1024):
    with Image.open(source) as image:
        if getattr(image, "n_frames", 1) < 2:
            return None
        durations = []
        for index in range(image.n_frames):
            image.seek(index)
            durations.append(max(20, int(image.info.get("duration", 100))))
        total_ms = sum(durations)
        ratio = min(1, max_edge / max(image.size))
        width, height = max(1, round(image.width * ratio)), max(1, round(image.height * ratio))
        count = min(max_frames, max(2, round(total_ms * fps / 1000)))
        while count > 2:
            columns = min(4, count)
            rows = math.ceil(count / columns)
            if columns * width * rows * height * 4 <= max_decoded_bytes:
                break
            count -= 1
        columns = min(4, count)
        rows = math.ceil(count / columns)
        frame_ms = total_ms / count
        atlas = Image.new("RGB", (columns * width, rows * height), (9, 29, 35))
        source_index, elapsed = 0, durations[0]
        image.seek(0)
        for index in range(count):
            timestamp = (index + .5) * frame_ms
            while timestamp >= elapsed and source_index < image.n_frames - 1:
                source_index += 1
                elapsed += durations[source_index]
            image.seek(source_index)
            frame = image.convert("RGBA")
            if frame.size != (width, height):
                frame = frame.resize((width, height), Image.Resampling.LANCZOS)
            background = Image.new("RGB", frame.size, (9, 29, 35))
            background.paste(frame, mask=frame.getchannel("A"))
            atlas.paste(background, ((index % columns) * width, (index // columns) * height))
        destination.parent.mkdir(parents=True, exist_ok=True)
        # Preserve colored lettering; avoid another lossy encode in the phone build.
        atlas.save(destination, "JPEG", quality=quality, subsampling=0, optimize=True)
        return {"frame_width": width, "frame_height": height, "columns": columns,
                "frames": count, "frame_ms": frame_ms,
                "source_width": image.width, "source_height": image.height,
                "decoded_bytes": atlas.width * atlas.height * 4}
