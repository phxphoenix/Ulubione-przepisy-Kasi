#!/usr/bin/env python3
"""Safely deletes a recipe JSON file and any orphaned local recipe images."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
from typing import Any, Optional, Sequence

REPO_ROOT = Path(__file__).resolve().parent.parent
RECIPES_DIR = REPO_ROOT / "src" / "content" / "recipes"
PUBLIC_DIR = REPO_ROOT / "public"
RECIPES_IMAGES_DIR = PUBLIC_DIR / "images" / "recipes"


def _is_safe_slug(slug: str) -> bool:
    if not slug or slug in {".", ".."}:
        return False
    if "/" in slug or "\\" in slug or ".." in slug:
        return False
    if any(ch.isspace() or ord(ch) < 32 for ch in slug):
        return False
    return True


def _extract_local_recipe_images(data: Any) -> set[Path]:
    """Return resolved file paths under public/images/recipes referenced by recipe data."""
    if not isinstance(data, dict):
        return set()

    candidates: list[str] = []
    raw_images = data.get("images")
    if isinstance(raw_images, list):
        for img in raw_images:
            if isinstance(img, dict) and isinstance(img.get("url"), str):
                candidates.append(img["url"])

    raw_steps = data.get("steps")
    if isinstance(raw_steps, list):
        for step in raw_steps:
            if isinstance(step, dict) and isinstance(step.get("imageUrl"), str):
                candidates.append(step["imageUrl"])

    images_root = RECIPES_IMAGES_DIR.resolve()
    matched_paths: set[Path] = set()
    for raw_url in candidates:
        normalized = raw_url.strip().lstrip("/")
        if not normalized.startswith("images/recipes/"):
            continue
        target = (PUBLIC_DIR / normalized).resolve()
        if target.is_relative_to(images_root) and target != images_root:
            matched_paths.add(target)

    return matched_paths


def _load_json_safe(path: Path) -> Optional[dict[str, Any]]:
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
        return loaded if isinstance(loaded, dict) else None
    except Exception:
        return None


def _find_matching_recipe_files(slug: str, recipes_dir: Path) -> list[Path]:
    if not recipes_dir.exists():
        return []

    recipes_root = recipes_dir.resolve()
    direct_path = (recipes_dir / f"{slug}.json").resolve()
    matches: list[Path] = []

    if direct_path.is_relative_to(recipes_root) and direct_path.is_file():
        matches.append(direct_path)

    for json_file in sorted(recipes_dir.glob("*.json")):
        resolved = json_file.resolve()
        if resolved in matches or not resolved.is_relative_to(recipes_root):
            continue
        data = _load_json_safe(resolved)
        if data is None:
            if resolved.stem == slug:
                matches.append(resolved)
            continue
        file_slug = str(data.get("slug") or "").strip()
        file_id = str(data.get("id") or "").strip()
        if slug in {file_slug, file_id, resolved.stem}:
            matches.append(resolved)

    return matches


def delete_recipe_by_slug(
    slug: str,
    recipes_dir: Path = RECIPES_DIR,
) -> tuple[bool, list[Path]]:
    """Delete matching recipe JSON file(s) and unreferenced local images.

    Returns (changed, deleted_paths).
    """
    clean_slug = slug.strip()
    if not _is_safe_slug(clean_slug):
        raise ValueError(f"Nieprawidłowy identyfikator przepisu (slug): {slug!r}")

    targets = _find_matching_recipe_files(clean_slug, recipes_dir)
    if not targets:
        return False, []

    deleted_paths: list[Path] = []
    candidate_images: set[Path] = set()

    for target in targets:
        data = _load_json_safe(target)
        candidate_images.update(_extract_local_recipe_images(data))
        target.unlink()
        deleted_paths.append(target)

    still_referenced_images: set[Path] = set()
    for remaining_file in recipes_dir.glob("*.json"):
        remaining_data = _load_json_safe(remaining_file)
        still_referenced_images.update(_extract_local_recipe_images(remaining_data))

    for image_path in sorted(candidate_images - still_referenced_images):
        if image_path.is_file():
            image_path.unlink()
            deleted_paths.append(image_path)

    # Keep directory present in Git even when the last recipe JSON is deleted
    # so Astro's glob content loader never sees a missing base directory.
    if not any(recipes_dir.glob("*.json")):
        gitkeep = recipes_dir / ".gitkeep"
        if not gitkeep.exists():
            gitkeep.write_text("", encoding="utf-8")

    return True, deleted_paths


def _emit_outputs(changed: bool, slug: str) -> None:
    changed_str = "true" if changed else "false"
    print(f"changed={changed_str}")
    print(f"deleted_slug={slug}")

    github_output = os.environ.get("GITHUB_OUTPUT", "").strip()
    if github_output:
        with open(github_output, "a", encoding="utf-8") as handle:
            handle.write(f"changed={changed_str}\n")
            handle.write(f"deleted_slug={slug}\n")


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Usuwa przepis JSON i powiązane nieużywane lokalne zdjęcia."
    )
    parser.add_argument(
        "--slug",
        required=True,
        help="Slug (identyfikator) przepisu do usunięcia.",
    )
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    clean_slug = args.slug.strip()

    try:
        changed, deleted_paths = delete_recipe_by_slug(clean_slug)
    except ValueError as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"[ERROR] Błąd podczas usuwania przepisu: {exc}", file=sys.stderr)
        return 1

    if changed:
        for path in deleted_paths:
            print(f"[DELETED] {path.relative_to(REPO_ROOT)}")
    else:
        print(
            f"[INFO] Przepis '{clean_slug}' nie istnieje już w src/content/recipes/ — brak zmian."
        )

    _emit_outputs(changed, clean_slug)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
