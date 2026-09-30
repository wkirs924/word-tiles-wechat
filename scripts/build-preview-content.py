#!/usr/bin/env python3
"""Build the WeChat preview content package from the pinned Godot catalog.

Sources:
  reference/godot/content/catalog.json            (stable keys, titles, keywords, decks, theme)
  <original>/assets/imported/**, assets/ui/*.svg  (the exact images the PC version shows)

Outputs:
  assets/materials/                     project-owned copies of the source materials
  apps/wechat-preview/assets/memes/     web/WeChat friendly meme images (jpg/png)
  apps/wechat-preview/assets/animations/ sampled animation atlases (jpg)
  apps/wechat-preview/assets/ui/        rasterized UI images (png/jpg)
  apps/wechat-preview/content.js        generated client manifest (loadable in browser and wx)

No runtime dependency: this is an offline build tool. Re-run it after replacing materials.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image
from animation_assets import encode_animation

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "reference" / "godot" / "content" / "catalog.json"
DEFAULT_ORIGINAL = Path(
    r"C:\Users\cyr\Documents\Codex\2026-09-18\1-2-2-3-4-1\outputs\word_tiles_m3_m4"
)
DEFAULT_GODOT = Path(r"C:\Users\cyr\bin\godot_console.exe")
PREVIEW = ROOT / "apps" / "wechat-preview"
MATERIALS = ROOT / "assets" / "materials"
MEME_MAX_SIDE = 640
GIF_SOURCES = Path(r"E:\总素材\gif素材")
JPEG_QUALITY = 82
TV_BACKGROUND = (9, 29, 35)


def load_catalog() -> dict:
    return json.loads(CATALOG.read_text(encoding="utf-8-sig"))


def copy_materials(original: Path, catalog: dict) -> int:
    (MATERIALS / "memes").mkdir(parents=True, exist_ok=True)
    (MATERIALS / "ui").mkdir(parents=True, exist_ok=True)
    copied = 0
    for asset in catalog["assets"]:
        source = original / asset["path"].replace("/", "\\")
        if not source.exists():
            raise SystemExit(f"missing source material: {source}")
        if asset["kind"] == "meme":
            target = MATERIALS / "memes" / (asset["key"] + source.suffix.lower())
        else:
            target = MATERIALS / "ui" / source.name
        if not target.exists() or source.stat().st_mtime_ns > target.stat().st_mtime_ns:
            shutil.copy2(source, target)
            copied += 1
    catalog_copy = MATERIALS / "catalog.json"
    if not catalog_copy.exists() or CATALOG.stat().st_mtime_ns > catalog_copy.stat().st_mtime_ns:
        shutil.copy2(CATALOG, catalog_copy)
        copied += 1
    return copied


def rasterize_ui(godot: Path) -> dict[str, Path]:
    work = ROOT / ".tmp" / "svg-raster"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    shutil.copy2(ROOT / "scripts" / "tools" / "rasterize_svg.gd", work / "rasterize.gd")
    (work / "project.godot").write_text(
        'config_version=5\n\n[application]\nconfig/name="svg-raster"\n', encoding="utf-8"
    )
    output = work / "out"
    command = [
        str(godot),
        "--headless",
        "--path",
        str(work),
        "--script",
        "res://rasterize.gd",
        "--",
        "--input",
        str(MATERIALS / "ui"),
        "--output",
        str(output),
        "--scale",
        "2",
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    if result.returncode != 0:
        raise SystemExit("godot svg rasterize failed")
    return {path.stem: path for path in output.glob("*.png")}


def build_ui_png(rasterized: dict[str, Path], catalog: dict) -> dict[str, str]:
    out_dir = PREVIEW / "assets" / "ui"
    out_dir.mkdir(parents=True, exist_ok=True)
    mapping = {
        "table": ("table.jpg", 1600),
        "tile": ("tile.png", None),
        "tile_back": ("tile_back.png", None),
        "mark": ("mark.png", None),
        "avatar_east": ("avatar_east.png", None),
        "avatar_south": ("avatar_south.png", None),
        "avatar_west": ("avatar_west.png", None),
        "avatar_north": ("avatar_north.png", None),
    }
    ui_paths: dict[str, str] = {}
    for key, source_name in [
        ("ui.background", "table"),
        ("ui.tile", "tile"),
        ("ui.tile_back", "tile_back"),
        ("ui.mark", "mark"),
        ("ui.avatar_east", "avatar_east"),
        ("ui.avatar_south", "avatar_south"),
        ("ui.avatar_west", "avatar_west"),
        ("ui.avatar_north", "avatar_north"),
    ]:
        source = rasterized.get(source_name)
        if source is None:
            raise SystemExit(f"rasterize output missing: {source_name}")
        file_name, max_width = mapping[source_name]
        image = Image.open(source)
        if max_width and image.width > max_width:
            ratio = max_width / image.width
            image = image.resize((max_width, max(1, round(image.height * ratio))), Image.LANCZOS)
        if file_name.endswith(".jpg"):
            if image.mode in ("RGBA", "LA", "P"):
                background = Image.new("RGB", image.size, TV_BACKGROUND)
                converted = image.convert("RGBA")
                background.paste(converted, mask=converted.split()[-1])
                image = background
            else:
                image = image.convert("RGB")
            image.save(out_dir / file_name, quality=88, optimize=True)
        else:
            image.save(out_dir / file_name, optimize=True)
        ui_paths[key] = f"assets/ui/{file_name}"
    return ui_paths


def build_animation(source: Path, key: str) -> dict | None:
    relative = f"assets/animations/{key}.jpg"
    meta = encode_animation(source, PREVIEW / relative)
    return {"path": relative, **meta} if meta else None


def build_memes(catalog: dict, gif_sources: Path) -> list[dict]:
    out_dir = PREVIEW / "assets" / "memes"
    out_dir.mkdir(parents=True, exist_ok=True)
    memes: list[dict] = []
    if not gif_sources.is_dir():
        raise SystemExit(f"missing GIF source directory: {gif_sources}")
    source_files = {path.stem: path for path in gif_sources.rglob("*") if path.is_file()}
    for asset in catalog["assets"]:
        if asset["kind"] != "meme":
            continue
        source = MATERIALS / "memes" / (asset["key"] + Path(asset["path"]).suffix.lower())
        image = Image.open(source)
        keep_alpha = image.mode in ("RGBA", "LA") and image.getextrema()[-1][0] < 255
        if image.width > MEME_MAX_SIDE or image.height > MEME_MAX_SIDE:
            ratio = MEME_MAX_SIDE / max(image.width, image.height)
            size = (max(1, round(image.width * ratio)), max(1, round(image.height * ratio)))
            image = image.resize(size, Image.LANCZOS)
        file_name = asset["key"] + (".png" if keep_alpha else ".jpg")
        if keep_alpha:
            image.save(out_dir / file_name, optimize=True)
        else:
            image.convert("RGB").save(out_dir / file_name, quality=JPEG_QUALITY, optimize=True)
        meme = {
                "key": asset["key"],
                "kind": "meme",
                "title": asset["title"],
                "keywords": list(asset["keywords"]),
                "usage": asset.get("usage", ""),
                "path": f"assets/memes/{file_name}",
            }
        original = source_files.get(asset["title"])
        if original is None:
            raise SystemExit(f"missing GIF source for {asset['key']}: {asset['title']}")
        animation = build_animation(original, asset["key"])
        if animation:
            meme["animation"] = animation
        memes.append(meme)
    return memes


def write_content(catalog: dict, memes: list[dict], ui_paths: dict[str, str]) -> None:
    content = {
        "schema_version": 1,
        "content_version": f"content-wx-preview-{catalog['revision']}",
        "rules_version": catalog.get("rules_version", "word-tiles-4"),
        "title": catalog["title"],
        "theme": catalog["theme"],
        "ui": catalog["ui"],
        "playback": catalog.get("playback", {"seconds_per_image": 2}),
        "font": catalog.get("font"),
        "ui_paths": ui_paths,
        "memes": memes,
        "deck_presets": [
            {"id": preset["id"], "title": preset["title"], "deck": preset["deck"]}
            for preset in catalog.get("deck_presets", [])
        ],
    }
    payload = json.dumps(content, ensure_ascii=False, separators=(",", ":"))
    body = (
        "// Generated by scripts/build-preview-content.py. Do not edit.\n"
        "(function (root) {\n"
        f"  var CONTENT = {payload};\n"
        "  root.__WORD_TILES_CONTENT__ = CONTENT;\n"
        "  if (typeof module !== 'undefined' && module.exports) module.exports = CONTENT;\n"
        "})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof globalThis !== 'undefined' ? globalThis : this));\n"
    )
    (PREVIEW / "content.js").write_text(body, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--original", type=Path, default=DEFAULT_ORIGINAL)
    parser.add_argument("--godot", type=Path, default=DEFAULT_GODOT)
    parser.add_argument("--skip-rasterize", action="store_true")
    parser.add_argument("--gif-sources", type=Path, default=GIF_SOURCES)
    parser.add_argument("--animations-only", action="store_true", help="Rebuild original GIF atlases and manifest without rasterizing UI")
    args = parser.parse_args()
    if args.animations_only:
        manifest = PREVIEW / "content.js"
        source = manifest.read_text(encoding="utf-8")
        match = re.search(r"var CONTENT = (\{.*\});", source)
        content = json.loads(match.group(1))
        originals = {p.stem: p for p in sorted(args.gif_sources.rglob("*")) if p.is_file()}
        for meme in content["memes"]:
            if meme["title"] not in originals:
                raise SystemExit("Missing original: " + meme["title"])
            animation = build_animation(originals[meme["title"]], meme["key"])
            if animation:
                meme["animation"] = animation
            else:
                meme.pop("animation", None)
        payload = json.dumps(content, ensure_ascii=False, separators=(",", ":"))
        manifest.write_text(source[:match.start(1)] + payload + source[match.end(1):], encoding="utf-8")
        print("Rebuilt animations from original GIFs: " + str(sum("animation" in m for m in content["memes"])))
        return
    if not CATALOG.exists():
        raise SystemExit(f"catalog not found: {CATALOG}")
    if not args.original.exists():
        raise SystemExit(f"original project not found: {args.original}")
    catalog = load_catalog()
    copied = copy_materials(args.original, catalog)
    print(f"materials copied/updated: {copied}")
    if args.skip_rasterize:
        rasterized = {}
    else:
        rasterized = rasterize_ui(args.godot)
    if rasterized:
        ui_paths = build_ui_png(rasterized, catalog)
    else:
        existing = {}
        for key, name in [
            ("ui.background", "table.jpg"),
            ("ui.tile", "tile.png"),
            ("ui.tile_back", "tile_back.png"),
            ("ui.mark", "mark.png"),
            ("ui.avatar_east", "avatar_east.png"),
            ("ui.avatar_south", "avatar_south.png"),
            ("ui.avatar_west", "avatar_west.png"),
            ("ui.avatar_north", "avatar_north.png"),
        ]:
            if (PREVIEW / "assets" / "ui" / name).exists():
                existing[key] = f"assets/ui/{name}"
        ui_paths = existing
    memes = build_memes(catalog, args.gif_sources)
    write_content(catalog, memes, ui_paths)
    print(f"memes built: {len(memes)}")
    print(f"decks built: {len(catalog.get('deck_presets', []))}")
    print(f"content.js written: {PREVIEW / 'content.js'}")


if __name__ == "__main__":
    main()
