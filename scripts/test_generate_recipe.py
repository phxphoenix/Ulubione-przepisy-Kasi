#!/usr/bin/env python3
"""Unit tests for Layer 0, Layer 1 (Facebook), and Layer 2 (fallback image search) in generate_recipe.py."""

from __future__ import annotations

import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_recipe as gr


def _make_png_bytes(width: int, height: int) -> bytes:
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + ihdr


def _make_jpeg_bytes(width: int, height: int) -> bytes:
    sof0 = b"\xff\xc0" + struct.pack(">HBHH", 11, 8, height, width) + b"\x03\x01\x11\x00\x02\x11\x00\x03\x11\x00"
    return b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + sof0 + b"\xff\xd9"


class TestLayer0ImageFiltering(unittest.TestCase):
    def test_rejects_facebook_ui_junk_urls(self) -> None:
        self.assertFalse(
            gr.is_valid_image_candidate("https://static.xx.fbcdn.net/rsrc.php/yH/r/ckVwrvbnQCI.webp")
        )
        self.assertFalse(
            gr.is_valid_image_candidate("https://www.facebook.com/images/icons/FBLogo_Blueprint.png")
        )
        self.assertFalse(
            gr.is_valid_image_candidate("https://scontent.xx.fbcdn.net/hads-ak-prn2/1487645_6012475414660_1439393861_n.png")
        )

    def test_accepts_real_recipe_images(self) -> None:
        self.assertTrue(
            gr.is_valid_image_candidate("https://www.kwestiasmaku.com/sites/v123.kwestiasmaku.com/files/placki.jpg")
        )
        self.assertTrue(
            gr.is_valid_image_candidate("https://scontent-waw2-1.xx.fbcdn.net/v/t51.82787-15/900998964_n.jpg?oe=6AFD086D")
        )

    def test_parse_image_dimensions_png_and_jpeg(self) -> None:
        self.assertEqual(gr._parse_image_dimensions(_make_png_bytes(800, 600)), (800, 600))
        self.assertEqual(gr._parse_image_dimensions(_make_jpeg_bytes(1280, 960)), (1280, 960))

    def test_verify_image_candidates_handles_reject_and_cloudflare_inconclusive(self) -> None:
        candidates = [
            gr.ImageCandidate(url="https://example.com/tiny.png", source="article-img", priority=3),
            gr.ImageCandidate(url="https://cf.example.com/dish.webp", source="og:image", priority=2),
            gr.ImageCandidate(url="https://cf.example.com/markdown.webp", source="jina-markdown", priority=4),
        ]

        def fake_probe(url: str, *, referer: str | None = None, user_agent: str | None = None):
            if "tiny" in url:
                return "reject", (32, 32), 522
            return "inconclusive", None, None

        with mock.patch.object(gr, "_probe_image_url", side_effect=fake_probe):
            kept = gr._verify_image_candidates(candidates, referer="https://example.com/")

        self.assertEqual([c.url for c in kept], ["https://cf.example.com/dish.webp"])


class TestLayer1FacebookAndPersistence(unittest.TestCase):
    def test_facebook_host_and_ephemeral_detection(self) -> None:
        self.assertTrue(gr._is_facebook_url("https://www.facebook.com/share/r/1E3y85LRky/"))
        self.assertTrue(gr._is_facebook_url("https://fb.watch/abc123/"))
        self.assertFalse(gr._is_facebook_url("https://www.kwestiasmaku.com/przepis/churros"))

        self.assertTrue(
            gr._is_ephemeral_image_url("https://scontent-waw2-1.xx.fbcdn.net/v/t51/photo.jpg?oe=6AFD086D")
        )
        self.assertFalse(
            gr._is_ephemeral_image_url("https://upload.wikimedia.org/wikipedia/commons/5/52/Bramboracky.jpg")
        )

    def test_parse_html_document_recovers_og_title_and_og_image_when_body_empty(self) -> None:
        html = """<!doctype html><html><head>
        <meta property="og:title" content="Placki ziemniaczane z dynią\nSKŁADNIKI:\n- 400 g dyni" />
        <meta property="og:image" content="https://scontent-waw2-1.xx.fbcdn.net/v/t51/photo.jpg?oe=6AFD086D" />
        </head><body></body></html>"""
        parsed = gr.parse_html_document(html, "https://www.facebook.com/share/r/1/", "https://www.facebook.com/reel/2/")
        self.assertIn("Placki ziemniaczane z dynią", parsed["article_text"])
        self.assertEqual(len(parsed["images"]), 1)
        self.assertEqual(parsed["images"][0].source, "og:image")

    def test_persist_ephemeral_images_saves_local_file_and_rewrites_step(self) -> None:
        fb_url = "https://scontent-waw2-1.xx.fbcdn.net/v/t51/photo.jpg?oe=6AFD086D"
        fake_jpeg = _make_jpeg_bytes(800, 600) + (b"\x00" * 6000)

        fake_resp = mock.MagicMock()
        fake_resp.headers = {"Content-Type": "image/jpeg"}
        fake_resp.content = fake_jpeg
        fake_resp.raise_for_status.return_value = None

        with tempfile.TemporaryDirectory() as tmpdir:
            img_dir = Path(tmpdir) / "images" / "recipes"
            images = [{"url": fb_url, "caption": "Placki", "isMain": True}]
            steps = [{"stepNumber": 1, "instruction": "Usmaż.", "imageUrl": fb_url}]

            with mock.patch.object(gr.requests, "get", return_value=fake_resp):
                out_images, out_steps = gr._persist_ephemeral_images(
                    images, steps, "placki-test", img_dir
                )

            expected_local = "/images/recipes/placki-test-main.jpg"
            self.assertEqual(out_images[0]["url"], expected_local)
            self.assertEqual(out_steps[0]["imageUrl"], expected_local)
            self.assertTrue((img_dir / "placki-test-main.jpg").is_file())


class TestLayer2FallbackBranch(unittest.TestCase):
    def test_prompt_switches_to_search_queries_when_no_images(self) -> None:
        data = gr.ExtractedPageData(
            source_url="https://www.facebook.com/reel/123",
            final_url="https://www.facebook.com/reel/123",
            language_hint="pl",
            json_ld_recipes=[],
            image_candidates=[],
            video_candidates=[],
            html_article_text="Przepis bez zdjęć.",
            jina_markdown="",
        )
        prompt = gr.build_prompt(data)
        self.assertIn("imageSearchQueries", prompt)
        self.assertIn("INSTRUKCJA ROZGAŁĘZIENIA", prompt)

    def test_finalize_recipe_uses_fallback_search_when_no_source_images(self) -> None:
        extracted = gr.ExtractedPageData(
            source_url="https://www.facebook.com/reel/123",
            final_url="https://www.facebook.com/reel/123",
            language_hint="pl",
            json_ld_recipes=[],
            image_candidates=[],
            video_candidates=[],
            html_article_text="Przepis testowy",
            jina_markdown="",
        )
        raw_recipe = {
            "slug": "placki-dyniowe",
            "title": "Placki ziemniaczane z dynią",
            "summary": "Złociste placki z dynią.",
            "category": "Dania główne",
            "tags": ["placki", "dynia"],
            "totalTimeMinutes": 30,
            "servings": 4,
            "difficulty": "Łatwy",
            # Even if LLM hallucinated a URL here, _sanitize_images must ignore it when no candidates exist
            "images": [{"url": "https://hallucinated.example/fake.jpg", "isMain": True}],
            "imageSearchQueries": ["Placki ziemniaczane z dynią", "Potato pancakes"],
            "videos": [],
            "ingredientGroups": [{"items": [{"name": "ziemniaki", "amount": 500, "unit": "g"}]}],
            "steps": [{"stepNumber": 1, "instruction": "Zetrzyj i usmaż."}],
            "chefTips": [],
            "originalLanguage": "pl",
        }

        fallback_result = [
            {
                "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/52/Brambor%C3%A1%C4%8Dky_01.jpg/1280px-Brambor%C3%A1%C4%8Dky_01.jpg",
                "caption": "Placki ziemniaczane z dynią (zdjęcie poglądowe)",
                "isMain": True,
            }
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            recipes_dir = Path(tmpdir) / "recipes"
            images_dir = Path(tmpdir) / "images"
            recipe = gr.finalize_recipe(
                raw_recipe,
                extracted,
                recipes_dir,
                recipes_images_dir=images_dir,
                fallback_image_search_fn=mock.Mock(return_value=fallback_result),
            )

        self.assertEqual(len(recipe.images), 1)
        self.assertEqual(recipe.images[0].url, fallback_result[0]["url"])
        self.assertTrue(recipe.images[0].isMain)
        self.assertNotIn("imageSearchQueries", recipe.model_dump())


if __name__ == "__main__":
    unittest.main()
