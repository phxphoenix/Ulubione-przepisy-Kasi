#!/usr/bin/env python3
"""Unit and CLI tests for scripts/delete_recipe.py."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import delete_recipe as dr


def _write_recipe_json(
    directory: Path,
    filename: str,
    *,
    slug: str,
    recipe_id: str | None = None,
    images: list[dict] | None = None,
    steps: list[dict] | None = None,
) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    payload: dict = {
        "slug": slug,
        "title": f"Przepis {slug}",
        "images": images or [{"url": "https://example.com/pic.jpg", "isMain": True}],
        "steps": steps or [{"stepNumber": 1, "instruction": "Wymieszaj."}],
    }
    if recipe_id is not None:
        payload["id"] = recipe_id
    path = directory / filename
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


class TestSafeSlugValidation(unittest.TestCase):
    def test_accepts_valid_slugs(self) -> None:
        self.assertTrue(dr._is_safe_slug("rigatoni-alla-vodka"))
        self.assertTrue(dr._is_safe_slug("krewetki_2"))
        self.assertTrue(dr._is_safe_slug("placki-123"))

    def test_rejects_unsafe_or_empty_slugs(self) -> None:
        for bad in ("", ".", "..", "../secret", "a/b", "a\\b", "slug z spacja", "bad\nslug", "foo..bar"):
            with self.subTest(bad=bad):
                self.assertFalse(dr._is_safe_slug(bad))


class TestDeleteRecipeBySlug(unittest.TestCase):
    def test_deletes_recipe_and_orphaned_local_images(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            recipes_dir = root / "src" / "content" / "recipes"
            public_dir = root / "public"
            images_dir = public_dir / "images" / "recipes"
            images_dir.mkdir(parents=True)

            main_img = images_dir / "zupa-main.jpg"
            step_img = images_dir / "zupa-step-1.jpg"
            unrelated_img = images_dir / "other-main.jpg"
            main_img.write_bytes(b"img-main")
            step_img.write_bytes(b"img-step")
            unrelated_img.write_bytes(b"img-other")

            recipe_path = _write_recipe_json(
                recipes_dir,
                "zupa-krem.json",
                slug="zupa-krem",
                images=[
                    {"url": "/images/recipes/zupa-main.jpg", "isMain": True},
                    {"url": "https://cdn.example.com/external.jpg", "isMain": False},
                ],
                steps=[
                    {"stepNumber": 1, "instruction": "Gotuj.", "imageUrl": "/images/recipes/zupa-step-1.jpg"}
                ],
            )
            _write_recipe_json(
                recipes_dir,
                "inne-danie.json",
                slug="inne-danie",
                images=[{"url": "/images/recipes/other-main.jpg", "isMain": True}],
            )

            with (
                mock.patch.object(dr, "PUBLIC_DIR", public_dir),
                mock.patch.object(dr, "RECIPES_IMAGES_DIR", images_dir),
            ):
                changed, deleted_paths = dr.delete_recipe_by_slug("zupa-krem", recipes_dir=recipes_dir)

            self.assertTrue(changed)
            self.assertFalse(recipe_path.exists())
            self.assertFalse(main_img.exists())
            self.assertFalse(step_img.exists())
            self.assertTrue(unrelated_img.exists())
            self.assertEqual(set(deleted_paths), {recipe_path.resolve(), main_img.resolve(), step_img.resolve()})

    def test_preserves_shared_local_images_referenced_by_other_recipes(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            recipes_dir = root / "src" / "content" / "recipes"
            public_dir = root / "public"
            images_dir = public_dir / "images" / "recipes"
            images_dir.mkdir(parents=True)

            shared_img = images_dir / "shared.jpg"
            shared_img.write_bytes(b"shared")

            _write_recipe_json(
                recipes_dir,
                "przepis-a.json",
                slug="przepis-a",
                images=[{"url": "/images/recipes/shared.jpg", "isMain": True}],
            )
            _write_recipe_json(
                recipes_dir,
                "przepis-b.json",
                slug="przepis-b",
                images=[{"url": "/images/recipes/shared.jpg", "isMain": True}],
            )

            with (
                mock.patch.object(dr, "PUBLIC_DIR", public_dir),
                mock.patch.object(dr, "RECIPES_IMAGES_DIR", images_dir),
            ):
                changed, deleted_paths = dr.delete_recipe_by_slug("przepis-a", recipes_dir=recipes_dir)

            self.assertTrue(changed)
            self.assertTrue(shared_img.exists())
            self.assertEqual(len(deleted_paths), 1)

    def test_ignores_path_traversal_image_references(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            recipes_dir = root / "src" / "content" / "recipes"
            public_dir = root / "public"
            images_dir = public_dir / "images" / "recipes"
            images_dir.mkdir(parents=True)

            protected_file = public_dir / "favicon.svg"
            protected_file.write_text("<svg/>", encoding="utf-8")

            _write_recipe_json(
                recipes_dir,
                "test-slug.json",
                slug="test-slug",
                images=[{"url": "/images/recipes/../../favicon.svg", "isMain": True}],
            )

            with (
                mock.patch.object(dr, "PUBLIC_DIR", public_dir),
                mock.patch.object(dr, "RECIPES_IMAGES_DIR", images_dir),
            ):
                changed, _ = dr.delete_recipe_by_slug("test-slug", recipes_dir=recipes_dir)

            self.assertTrue(changed)
            self.assertTrue(protected_file.exists())

    def test_creates_gitkeep_when_last_recipe_deleted(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            recipes_dir = root / "src" / "content" / "recipes"
            public_dir = root / "public"
            images_dir = public_dir / "images" / "recipes"
            images_dir.mkdir(parents=True)

            _write_recipe_json(recipes_dir, "ostatni.json", slug="ostatni")

            with (
                mock.patch.object(dr, "PUBLIC_DIR", public_dir),
                mock.patch.object(dr, "RECIPES_IMAGES_DIR", images_dir),
            ):
                changed, _ = dr.delete_recipe_by_slug("ostatni", recipes_dir=recipes_dir)

            self.assertTrue(changed)
            self.assertTrue((recipes_dir / ".gitkeep").is_file())

    def test_matches_by_inner_slug_or_id_when_filename_differs(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            recipes_dir = root / "src" / "content" / "recipes"
            public_dir = root / "public"
            images_dir = public_dir / "images" / "recipes"
            images_dir.mkdir(parents=True)

            target = _write_recipe_json(
                recipes_dir,
                "legacy-name.json",
                slug="kanoniczny-slug",
                recipe_id="kanoniczny-id",
            )

            with (
                mock.patch.object(dr, "PUBLIC_DIR", public_dir),
                mock.patch.object(dr, "RECIPES_IMAGES_DIR", images_dir),
            ):
                changed, _ = dr.delete_recipe_by_slug("kanoniczny-slug", recipes_dir=recipes_dir)

            self.assertTrue(changed)
            self.assertFalse(target.exists())

    def test_returns_false_when_missing_and_raises_for_invalid_slug(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            recipes_dir = Path(tmpdir) / "recipes"
            recipes_dir.mkdir(parents=True)
            changed, deleted = dr.delete_recipe_by_slug("nie-istnieje", recipes_dir=recipes_dir)
            self.assertFalse(changed)
            self.assertEqual(deleted, [])

            with self.assertRaises(ValueError):
                dr.delete_recipe_by_slug("../bad", recipes_dir=recipes_dir)


class TestDeleteRecipeCli(unittest.TestCase):
    def test_main_emits_github_output_and_handles_invalid_slug(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            gh_output = root / "github_output.txt"
            with (
                mock.patch.object(dr, "REPO_ROOT", root),
                mock.patch.object(dr, "delete_recipe_by_slug", return_value=(False, [])),
                mock.patch.dict(os.environ, {"GITHUB_OUTPUT": str(gh_output)}),
            ):
                exit_code = dr.main(["--slug", "brak-przepisu"])

            self.assertEqual(exit_code, 0)
            output_text = gh_output.read_text(encoding="utf-8")
            self.assertIn("changed=false", output_text)
            self.assertIn("deleted_slug=brak-przepisu", output_text)

            exit_bad = dr.main(["--slug", "../escape"])
            self.assertEqual(exit_bad, 1)


if __name__ == "__main__":
    unittest.main()
