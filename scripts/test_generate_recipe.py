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


class TestUrlAndVideoNormalization(unittest.TestCase):
    def test_validate_input_url_and_extract_source_domain(self) -> None:
        self.assertEqual(
            gr.validate_input_url("  https://www.kwestiasmaku.com/przepis/churros  "),
            "https://www.kwestiasmaku.com/przepis/churros",
        )
        with self.assertRaises(ValueError):
            gr.validate_input_url("ftp://example.com/recipe")
        with self.assertRaises(ValueError):
            gr.validate_input_url("not-a-url")

        self.assertEqual(
            gr.extract_source_domain("https://www.kwestiasmaku.com/przepis/churros"),
            "kwestiasmaku.com",
        )
        self.assertEqual(
            gr.extract_source_domain("https://simplehomeedit.com:8443/recipe"),
            "simplehomeedit.com",
        )

    def test_normalize_video_url_platforms(self) -> None:
        yt_watch = gr.normalize_video_url("https://www.youtube.com/watch?v=R9K1wS0VwLA", "https://example.com")
        self.assertIsNotNone(yt_watch)
        assert yt_watch is not None
        self.assertEqual(yt_watch.platform, "youtube")
        self.assertEqual(yt_watch.embed_url, "https://www.youtube-nocookie.com/embed/R9K1wS0VwLA")

        yt_short = gr.normalize_video_url("https://youtu.be/abc123XYZ", "https://example.com")
        self.assertIsNotNone(yt_short)
        assert yt_short is not None
        self.assertEqual(yt_short.embed_url, "https://www.youtube-nocookie.com/embed/abc123XYZ")

        ig_reel = gr.normalize_video_url("https://www.instagram.com/reels/C8xYzAbCdEf/?igsh=123", "https://example.com")
        self.assertIsNotNone(ig_reel)
        assert ig_reel is not None
        self.assertEqual(ig_reel.platform, "instagram")
        self.assertEqual(ig_reel.embed_url, "https://www.instagram.com/reel/C8xYzAbCdEf/embed")

        tt_vid = gr.normalize_video_url("https://www.tiktok.com/@chef/video/7345678901234567890?lang=pl", "https://example.com")
        self.assertIsNotNone(tt_vid)
        assert tt_vid is not None
        self.assertEqual(tt_vid.platform, "tiktok")
        self.assertEqual(tt_vid.embed_url, "https://www.tiktok.com/embed/v2/7345678901234567890")

        mp4_vid = gr.normalize_video_url("/media/prep.mp4", "https://example.com/przepis")
        self.assertIsNotNone(mp4_vid)
        assert mp4_vid is not None
        self.assertEqual(mp4_vid.platform, "mp4")
        self.assertEqual(mp4_vid.url, "https://example.com/media/prep.mp4")


class TestHtmlJsonLdAndPrompts(unittest.TestCase):
    def test_parse_html_document_resolves_jsonld_graph_refs_and_srcset(self) -> None:
        html = """<!doctype html>
        <html lang="en-US">
          <head>
            <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@graph": [
                  {
                    "@type": "ImageObject",
                    "@id": "https://example.com/#main-img",
                    "url": "https://example.com/images/lasagne-1200.jpg",
                    "width": 1200,
                    "height": 800
                  },
                  {
                    "@type": "Recipe",
                    "name": "Classic Lasagne",
                    "image": {"@id": "https://example.com/#main-img"},
                    "video": {"@type": "VideoObject", "contentUrl": "https://youtu.be/dQw4w9WgXcQ", "name": "Step video"}
                  }
                ]
              }
            </script>
          </head>
          <body>
            <nav>Menu główne</nav>
            <article>
              <h1>Classic Lasagne</h1>
              <p>Cook slowly for rich flavor with layered pasta, ragu, and creamy bechamel sauce.</p>
              <img srcset="https://example.com/small.jpg 150w, https://example.com/large.jpg 1024w" alt="Lasagne" />
            </article>
            <footer>Stopka strony</footer>
          </body>
        </html>"""
        parsed = gr.parse_html_document(html, "https://example.com/lasagne", "https://example.com/lasagne")
        self.assertEqual(parsed["language_hint"], "en-US")
        self.assertEqual(len(parsed["json_ld_recipes"]), 1)
        urls = [img.url for img in parsed["images"]]
        self.assertIn("https://example.com/images/lasagne-1200.jpg", urls)
        self.assertIn("https://example.com/large.jpg", urls)
        self.assertNotIn("https://example.com/small.jpg", urls)
        deduped_videos = gr._dedupe_videos(parsed["videos"])
        self.assertEqual(len(deduped_videos), 1)
        self.assertEqual(deduped_videos[0].platform, "youtube")
        self.assertNotIn("Menu główne", parsed["article_text"])
        self.assertNotIn("Stopka strony", parsed["article_text"])

    def test_challenge_detection_and_prompt_helpers(self) -> None:
        self.assertTrue(gr._is_challenge_or_error_text("Checking browser...", title="Just a moment..."))
        self.assertTrue(gr._is_challenge_or_error_text("Please verify you are human to proceed."))
        self.assertFalse(gr._is_challenge_or_error_text("Składniki: 500 g mąki, 2 jajka, 250 ml mleka.", title="Naleśniki"))

        extracted_json = gr._extract_json_block('<think>reasoning</think>\n```json\n{"slug": "test"}\n```')
        self.assertEqual(extracted_json, '{"slug": "test"}')

        data = gr.ExtractedPageData(
            source_url="https://example.com/zupa",
            final_url="https://example.com/zupa",
            language_hint="pl",
            json_ld_recipes=[{"name": "Zupa", "review": [{"author": "Jan"}]}],
            image_candidates=[gr.ImageCandidate(url="https://example.com/zupa.jpg", source="jsonld", priority=1)],
            video_candidates=[],
            html_article_text="Długi tekst " * 1000,
            jina_markdown="",
        )
        groq_prompt = gr.build_groq_prompt(data)
        self.assertIn("DANE STRUKTURALNE JSON-LD", groq_prompt)
        self.assertNotIn("WYCZYSZCZONA TREŚĆ STRONY", groq_prompt)
        self.assertNotIn('"review"', groq_prompt)

    def test_video_extraction_filters_social_feed_widgets_and_prioritizes_embeds(self) -> None:
        html_with_embed_and_widget = """<!doctype html>
        <html><body>
          <article>
            <h1>Crispy Potatoes</h1>
            <p>Roast at 220C until golden and crisp on all sides for best texture.</p>
            <iframe src="https://www.youtube.com/embed/I3TyuVfYHkQ" title="Roast Potatoes Video"></iframe>
            <div id="sb_instagram" class="sbi_feed">
              <a class="sbi_photo" href="https://www.instagram.com/reel/DfvPDr4gp-h/">Chicken Reel</a>
            </div>
            <a href="https://www.instagram.com/reel/DfiQCSDl_cd/">Zobacz mój inny przepis na burgery</a>
          </article>
        </body></html>"""
        parsed_embed = gr.parse_html_document(
            html_with_embed_and_widget,
            "https://example.com/potatoes",
            "https://example.com/potatoes",
        )
        prioritized = gr._select_prioritized_videos(parsed_embed["videos"])
        self.assertEqual(len(prioritized), 1)
        self.assertEqual(prioritized[0].platform, "youtube")
        self.assertEqual(prioritized[0].source, "iframe")

        html_widget_only = """<!doctype html>
        <html><body>
          <article>
            <h1>Roast Potatoes</h1>
            <p>Boil briefly, toss with flour and olive oil, then roast until crispy.</p>
            <div class="instagram-feed">
              <a href="https://www.instagram.com/reel/DfvPDr4gp-h/">Honey garlic chicken</a>
            </div>
            <a href="https://www.instagram.com/reel/DfiQCSDl_cd/"><img src="/thumb.jpg" alt="Burgers" /></a>
            <a href="https://www.instagram.com/reel/Dfg-DHQku07/">Instagram</a>
            <a href="https://www.youtube.com/watch?v=abc123XYZ">Zobacz film z przygotowania ziemniaków</a>
          </article>
        </body></html>"""
        parsed_links = gr.parse_html_document(
            html_widget_only,
            "https://example.com/potatoes",
            "https://example.com/potatoes",
        )
        self.assertEqual(len(parsed_links["videos"]), 1)
        self.assertEqual(parsed_links["videos"][0].platform, "youtube")
        self.assertEqual(parsed_links["videos"][0].title, "Zobacz film z przygotowania ziemniaków")

    def test_markdown_video_extraction_skips_image_tiles_and_social_clusters(self) -> None:
        markdown = """
        # The Best Roast Potatoes
        [![Post 1](https://example.com/1.jpg)](https://www.instagram.com/reel/Df05tLGDxk8/)
        [![Post 2](https://example.com/2.jpg)](https://www.instagram.com/reel/DfvPDr4gp-h/)
        [Instagram](https://www.instagram.com/reel/DfiQCSDl_cd/)
        https://www.instagram.com/reel/Dfg-DHQku07/
        https://www.tiktok.com/@chef/video/7345678901234567890
        [Zobacz instrukcję pieczenia ziemniaków](https://www.youtube.com/watch?v=R9K1wS0VwLA)
        """
        _, videos = gr._extract_media_from_markdown(
            markdown, "https://example.com/potatoes"
        )
        self.assertEqual(len(videos), 1)
        self.assertEqual(videos[0].platform, "youtube")
        self.assertEqual(videos[0].title, "Zobacz instrukcję pieczenia ziemniaków")

    def test_prompt_labels_video_trust_tiers_and_forbids_guessing(self) -> None:
        data = gr.ExtractedPageData(
            source_url="https://example.com/potatoes",
            final_url="https://example.com/potatoes",
            language_hint="en",
            json_ld_recipes=[],
            image_candidates=[gr.ImageCandidate(url="https://example.com/p.jpg", source="og:image", priority=2)],
            video_candidates=[
                gr.VideoCandidate(
                    url="https://www.youtube.com/watch?v=R9K1wS0VwLA",
                    platform="youtube",
                    embed_url="https://www.youtube-nocookie.com/embed/R9K1wS0VwLA",
                    title="Roast Potatoes",
                    source="iframe",
                ),
                gr.VideoCandidate(
                    url="https://www.instagram.com/reel/DfvPDr4gp-h/",
                    platform="instagram",
                    embed_url="https://www.instagram.com/reel/DfvPDr4gp-h/embed",
                    title=None,
                    source="article-link",
                ),
            ],
            html_article_text="Roast potatoes",
            jina_markdown="",
        )
        prompt = gr.build_prompt(data)
        self.assertIn("osadzone w przepisie", prompt)
        self.assertIn("link ze strony — dodaj tylko jeśli", prompt)
        self.assertIn("BEZWZGLĘDNIE pomijaj linki z widgetów społecznościowych", gr.SYSTEM_INSTRUCTION)
        self.assertIn("Nie wymyślaj URL-i ani tytułów wideo", gr.GROQ_SYSTEM_INSTRUCTION)


class TestSlugSanitizationAndAiCascade(unittest.TestCase):
    def test_generate_unique_slug_handles_polish_diacritics_and_collisions(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            recipes_dir = Path(tmpdir)
            self.assertEqual(
                gr.generate_unique_slug("Żurek staropolski z białą kiełbasą", recipes_dir),
                "zurek-staropolski-z-biala-kielbasa",
            )
            (recipes_dir / "zurek-staropolski.json").write_text('{"slug": "zurek-staropolski"}', encoding="utf-8")
            (recipes_dir / "zurek-staropolski-2.json").write_text('{"slug": "zurek-staropolski-2"}', encoding="utf-8")
            self.assertEqual(
                gr.generate_unique_slug("Żurek staropolski", recipes_dir),
                "zurek-staropolski-3",
            )

    def test_sanitize_images_steps_and_ingredients(self) -> None:
        candidates = [
            gr.ImageCandidate(url="https://example.com/step1.jpg", source="article-img", priority=3),
            gr.ImageCandidate(url="https://example.com/main.jpg", source="jsonld", priority=1),
        ]
        sanitized_imgs = gr._sanitize_images(
            [
                {"url": "https://example.com/step1.jpg", "caption": "Krok 1", "isMain": False},
                {"url": "https://hallucinated.example/bad.jpg", "isMain": True},
                {"url": "https://example.com/main.jpg", "caption": "Gotowe", "isMain": True},
            ],
            candidates,
        )
        self.assertEqual(len(sanitized_imgs), 2)
        self.assertEqual(sanitized_imgs[0]["url"], "https://example.com/main.jpg")
        self.assertTrue(sanitized_imgs[0]["isMain"])
        self.assertFalse(sanitized_imgs[1]["isMain"])

        steps = gr._sanitize_steps(
            [
                {"stepNumber": 9, "instruction": "  Wymieszaj mąkę. ", "imageUrl": "https://example.com/step1.jpg"},
                {"stepNumber": 2, "instruction": "   "},
                {"stepNumber": 3, "instruction": "Upiecz.", "imageUrl": "https://evil.example/fake.jpg"},
            ],
            {"https://example.com/step1.jpg", "https://example.com/main.jpg"},
        )
        self.assertEqual(len(steps), 2)
        self.assertEqual(steps[0]["stepNumber"], 1)
        self.assertEqual(steps[0]["imageUrl"], "https://example.com/step1.jpg")
        self.assertEqual(steps[1]["stepNumber"], 2)
        self.assertNotIn("imageUrl", steps[1])

        groups = gr._sanitize_ingredient_groups(
            [
                {"groupName": "  Ciasto ", "items": [{"name": "Mąka", "amount": 250.126, "unit": "g"}, {"name": ""}]},
                {"items": []},
            ]
        )
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["groupName"], "Ciasto")
        self.assertEqual(groups[0]["items"][0]["amount"], 250.13)

    def test_call_ai_with_fallback_cascades_from_gemini_to_openrouter_to_groq(self) -> None:
        with self.assertRaises(RuntimeError):
            gr.call_ai_with_fallback("prompt")

        expected = {"slug": "test", "title": "Test"}
        with (
            mock.patch.object(gr, "call_gemini_with_fallback", side_effect=RuntimeError("Gemini limit")),
            mock.patch.object(gr, "call_openrouter_with_fallback", side_effect=RuntimeError("OpenRouter limit")),
            mock.patch.object(gr, "call_groq_with_fallback", return_value=expected) as groq_mock,
        ):
            result = gr.call_ai_with_fallback(
                "full prompt",
                gemini_api_key="gem-key",
                openrouter_api_key="or-key",
                groq_api_key="groq-key",
                groq_prompt="compact groq prompt",
            )

        self.assertEqual(result, expected)
        groq_mock.assert_called_once_with("groq-key", "compact groq prompt")

    def test_save_recipe_and_emit_outputs_writes_json_and_github_output(self) -> None:
        extracted = gr.ExtractedPageData(
            source_url="https://www.example.com/pierogi",
            final_url="https://www.example.com/pierogi",
            language_hint="pl",
            json_ld_recipes=[],
            image_candidates=[gr.ImageCandidate(url="https://www.example.com/pierogi.jpg", source="jsonld", priority=1)],
            video_candidates=[],
            html_article_text="Pierogi ruskie",
            jina_markdown="",
        )
        raw = {
            "title": "Pierogi ruskie",
            "summary": "Domowe pierogi z serem i ziemniakami.",
            "category": "Dania główne",
            "tags": ["pierogi", "polskie"],
            "totalTimeMinutes": 60,
            "servings": 4,
            "difficulty": "Średni",
            "images": [{"url": "https://www.example.com/pierogi.jpg", "isMain": True}],
            "ingredientGroups": [{"items": [{"name": "Mąka", "amount": 500, "unit": "g"}]}],
            "steps": [{"stepNumber": 1, "instruction": "Zagnieć ciasto."}],
            "chefTips": [],
            "originalLanguage": "pl",
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            recipes_dir = root / "recipes"
            gh_output = root / "gh_output.txt"
            recipe = gr.finalize_recipe(raw, extracted, recipes_dir)
            with mock.patch.dict("os.environ", {"GITHUB_OUTPUT": str(gh_output)}):
                saved = gr.save_recipe_and_emit_outputs(recipe, recipes_dir)

            self.assertTrue(saved.is_file())
            gh_text = gh_output.read_text(encoding="utf-8")
            self.assertIn("recipe_slug=pierogi-ruskie", gh_text)
            self.assertIn("recipe_path=src/content/recipes/pierogi-ruskie.json", gh_text)


if __name__ == "__main__":
    unittest.main()
