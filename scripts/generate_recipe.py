#!/usr/bin/env python3
"""AI Agent generating structured Polish recipe JSON files for 'Ulubione przepisy Kasi'."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys
import time
from typing import Any, Literal, Optional, Sequence
from urllib.parse import parse_qs, urljoin, urlparse

from bs4 import BeautifulSoup, Tag
from google import genai
from google.genai import errors, types
import groq
from groq import Groq
import openai
from openai import OpenAI
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator
import requests
from slugify import slugify

try:
    import httpx
except ImportError:  # pragma: no cover
    httpx = None

REPO_ROOT = Path(__file__).resolve().parent.parent
RECIPES_DIR = REPO_ROOT / "src" / "content" / "recipes"

GROQ_EXCLUDED_MODEL_SUBSTRINGS: tuple[str, ...] = (
    "whisper",
    "guard",
    "tts",
    "embed",
    "safeguard",
    "vision",
    "orpheus",
    "allam",
)
GROQ_MODEL_PRIORITY_KEYWORDS: tuple[str, ...] = (
    "llama-4-maverick",
    "llama-4-scout",
    "gpt-oss-120b",
    "qwen3.8-27b",
    "qwen",
    "70b",
    "32b",
    "gpt-oss-20b",
)
DEFAULT_GEMINI_MODELS = (
    "gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.6-flash,gemini-3-flash,gemini-3.1-flash-lite"
)
GEMINI_MODEL_CASCADE: tuple[str, ...] = tuple(
    model.strip() for model in DEFAULT_GEMINI_MODELS.split(",") if model.strip()
)
MODEL_CASCADE = GEMINI_MODEL_CASCADE
JINA_RETRY_DELAYS_SECONDS: tuple[float, ...] = (2.0, 4.0)
GEMINI_LITE_THROTTLE_SECONDS = 4.5
GEMINI_FLASH_THROTTLE_SECONDS = 12.5
REQUEST_TIMEOUT_HTML = 20
REQUEST_TIMEOUT_JINA = 25
REQUEST_TIMEOUT_GROQ = 60.0
REQUEST_TIMEOUT_OPENROUTER = 60.0
FULL_PROMPT_TEXT_CHARS = 35000
OPENROUTER_PROMPT_TEXT_CHARS = 20000
GROQ_FALLBACK_TEXT_CHARS = 6500
GROQ_PROMPT_TEXT_CHARS = 12000
MAX_PROMPT_TEXT_CHARS = FULL_PROMPT_TEXT_CHARS
MAX_IMAGE_CANDIDATES = 25
MIN_IMAGE_DIMENSION_PX = 200
JINA_TRANSIENT_STATUS_CODES = frozenset({429, 500, 502, 503, 504})
JINA_USER_AGENT = "ulubione-przepisy-kasi/1.0"

OPENROUTER_FREE_MODELS: tuple[str, ...] = (
    "openrouter/free",
    "google/gemma-3-27b-it:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "mistralai/mistral-small-3.1-24b-instruct:free",
)

ALLOWED_CATEGORIES: tuple[str, ...] = (
    "Śniadania",
    "Zupy",
    "Dania główne",
    "Sałatki i przekąski",
    "Desery i wypieki",
    "Napoje i dodatki",
)
ALLOWED_DIFFICULTIES: tuple[str, ...] = ("Łatwy", "Średni", "Wymagający")
ALLOWED_VIDEO_PLATFORMS: tuple[str, ...] = ("youtube", "instagram", "tiktok", "mp4")

CategoryName = Literal[
    "Śniadania",
    "Zupy",
    "Dania główne",
    "Sałatki i przekąski",
    "Desery i wypieki",
    "Napoje i dodatki",
]
DifficultyLevel = Literal["Łatwy", "Średni", "Wymagający"]
VideoPlatform = Literal["youtube", "instagram", "tiktok", "mp4"]

BROWSER_HEADERS: dict[str, str] = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/135.0.0.0 Safari/537.36"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,*/*;q=0.8"
    ),
    "Accept-Language": "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
}

# r.jina.ai rejects requests from Python clients that spoof a desktop browser User-Agent.
JINA_HEADERS: dict[str, str] = {
    "User-Agent": JINA_USER_AGENT,
    "Accept": "text/plain, text/markdown;q=0.9, */*;q=0.8",
}

JINA_HTML_HEADERS: dict[str, str] = {
    "User-Agent": JINA_USER_AGENT,
    "Accept": "application/json",
    "X-Return-Format": "html",
}

SYSTEM_INSTRUCTION = """Jesteś redaktorem książki kucharskiej "Ulubione przepisy Kasi".

Twoim zadaniem jest przekształcenie surowych danych ze strony internetowej w kompletny, dopracowany, gotowy do gotowania przepis w formacie JSON zgodnym ze schematem.

Zasady redakcyjne (PRZESTRZEGAJ ICH BEZWZGLĘDNIE):
1. Język: Twórz treść wyłącznie w języku polskim (z poprawnymi polskimi znakami diakrytycznymi i naturalnym słownictwem kulinarnym). Jeśli źródło jest po angielsku lub w innym języku, przetłumacz w całości tytuł, podsumowanie, tagi, nazwy grup i składników, notatki, kroki przygotowania, wskazówki oraz podpisy zdjęć.
2. Jednostki metryczne: Przelicz wszystkie jednostki imperialne i anglosaskie na system metryczny oraz polskie miary kuchenne:
   - objętość płynów: cups / fl oz -> ml lub szklanki (1 cup = 240 ml, 1 szklanka = 250 ml, 1 fl oz = 30 ml),
   - masa: oz -> g (1 oz ≈ 28 g), lb -> g lub kg (1 lb ≈ 450 g),
   - miary kuchenne: tbsp -> łyżki, tsp -> łyżeczki,
   - wymiary: inch -> cm (1 inch ≈ 2,5 cm),
   - temperatury: °F -> °C zaokrąglone do pełnych 5°C (np. 350°F -> 180°C, 400°F -> 200°C, 425°F -> 220°C).
   Dla liczb składników zawsze podawaj wartość liczbową w `amount` (ułamki zapisz dziesiętnie, np. 0.5 zamiast 1/2), aby działał przelicznik porcji. Jedynie przy pozycjach bez ilości liczbowej (np. "sól do smaku") ustaw `amount` na null.
3. Zero dygresji: BEZWZGLĘDNIE usuń wszelkie historie rodzinne autora, wstępy blogowe, anegdoty, marketing, reklamy, polecenia produktów i dygresje. Zostaw wyłącznie czystą esencję kulinarną.
4. Kategoria: Przypisz przepis dokładnie do jednej z 6 dozwolonych kategorii:
   `Śniadania`, `Zupy`, `Dania główne`, `Sałatki i przekąski`, `Desery i wypieki`, `Napoje i dodatki`.
5. Poziom trudności: Wybierz dokładnie jedną wartość: `Łatwy`, `Średni` lub `Wymagający`.
6. Kroki przygotowania: Rozpisz kroki w sposób przejrzysty, logiczny i przystępny (krok po kroku), numerując je kolejno od 1. Nadaj każdemu krokowi zwięzły tytuł, konkretną instrukcję oraz (gdy warto) krótką wskazówkę techniczną `tip`.
7. Zdjęcia: Wybierz z dostarczonej listy znalezionych URL-i grafik najlepsze zdjęcie główne potrawy (`isMain: true` — dokładnie jedno zdjęcie główne) oraz opcjonalnie 1–5 dodatkowych zdjęć etapowych/prezentacyjnych (`isMain: false`) wraz z polskim opisem `caption`. Jeśli wybrane zdjęcie etapowe wyraźnie ilustruje konkretny krok, przypisz jego URL do pola `imageUrl` tego kroku. NIGDY nie wymyślaj adresów URL grafik — korzystaj wyłącznie z kandydatów z danych wejściowych.
8. Wideo: Jeśli w danych wejściowych wykryto linki wideo (YouTube, Instagram, TikTok, MP4), umieść je w tablicy `videos` i skonstruuj dla nich poprawne adresy `embedUrl`, aby działały bezpośrednio na stronie:
   - YouTube: `https://www.youtube-nocookie.com/embed/ID_FILMU`
   - Instagram: `https://www.instagram.com/{p|reel|tv}/KOD/embed`
   - TikTok: `https://www.tiktok.com/embed/v2/ID_FILMU`
   - MP4: bezpośredni adres URL pliku `.mp4`
   NIGDY nie wymyślaj linków wideo, jeśli nie zostały wykryte w danych wejściowych.
"""

NOISE_ANCESTOR_TAGS = frozenset({"nav", "footer", "aside"})
NOISE_ATTR_RE = re.compile(
    r"(?:^|[\s_-])(sidebar|comment|comments|avatar|gravatar|author-bio|"
    r"related-posts|newsletter|social-share|share-buttons|cookie|popup|modal|"
    r"advert|advertisement|ad-container|sponsored|promo-banner)(?:$|[\s_-])",
    re.IGNORECASE,
)
IMAGE_NOISE_PATH_RE = re.compile(
    r"(?:^|[/_\-.])(avatar|gravatar|emoji|smilies|favicon|spinner|loader|"
    r"spacer|pixel|blank|placeholder|doubleclick|googlesyndication|"
    r"adservice|adsystem|taboola|outbrain|wp-includes)(?:$|[/_\-.])",
    re.IGNORECASE,
)
IMAGE_NOISE_TOKEN_RE = re.compile(
    r"(?:^|[/_\-\s.])(logo|icon|badge|ads|advert|pin-it|share|placeholder)(?:$|[/_\-\s.])",
    re.IGNORECASE,
)
URL_DIM_SUFFIX_RE = re.compile(r"-(\d{1,4})x(\d{1,4})(?:\.[a-z0-9]+)?$", re.IGNORECASE)
MARKDOWN_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\((https?://[^\s)]+)\)")
RAW_URL_RE = re.compile(r"https?://[^\s<>\"'()\[\]]+")
YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,20}$")
INSTAGRAM_RE = re.compile(r"instagram\.com/(p|reel|reels|tv)/([^/?#]+)", re.IGNORECASE)
TIKTOK_VIDEO_RE = re.compile(
    r"tiktok\.com/(?:@[^/]+/video|embed(?:/v2)?|player/v1)/(\d+)",
    re.IGNORECASE,
)


def _strip_or_none(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned if cleaned else None


class RecipeImage(BaseModel):
    url: str = Field(..., description="Pełny adres URL zdjęcia z dostarczonej listy.")
    caption: Optional[str] = Field(
        default=None, description="Krótki podpis zdjęcia po polsku."
    )
    isMain: Optional[bool] = Field(
        default=None,
        description="Czy to zdjęcie główne potrawy (dokładnie jedno powinno mieć true).",
    )

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Image URL cannot be empty.")
        return cleaned

    @field_validator("caption")
    @classmethod
    def clean_caption(cls, value: Optional[str]) -> Optional[str]:
        return _strip_or_none(value)


class RecipeVideo(BaseModel):
    url: str = Field(..., description="Oryginalny adres URL materiału wideo.")
    platform: VideoPlatform = Field(
        ..., description="Platforma wideo: youtube, instagram, tiktok lub mp4."
    )
    embedUrl: str = Field(
        ...,
        description="Poprawny adres URL do osadzenia w iframe lub tagu video.",
    )
    title: Optional[str] = Field(
        default=None, description="Tytuł lub krótki opis wideo po polsku."
    )

    @field_validator("url", "embedUrl")
    @classmethod
    def validate_non_empty_url(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Video URL/embedUrl cannot be empty.")
        return cleaned

    @field_validator("title")
    @classmethod
    def clean_title(cls, value: Optional[str]) -> Optional[str]:
        return _strip_or_none(value)


class IngredientItem(BaseModel):
    name: str = Field(..., description="Nazwa składnika po polsku.")
    amount: Optional[float] = Field(
        default=None,
        description="Ilość liczbowa składnika (>= 0) lub null, gdy brak konkretnej miary.",
    )
    unit: Optional[str] = Field(
        default=None, description="Jednostka metryczna lub kuchenna (np. g, ml, łyżki, szt.)."
    )
    notes: Optional[str] = Field(
        default=None, description="Dodatkowe wskazówki (np. drobno posiekana, miękkie)."
    )

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Ingredient name cannot be empty.")
        return cleaned

    @field_validator("amount")
    @classmethod
    def validate_amount(cls, value: Optional[float]) -> Optional[float]:
        if value is not None and value < 0:
            raise ValueError("Ingredient amount cannot be negative.")
        return value

    @field_validator("unit", "notes")
    @classmethod
    def clean_optional_text(cls, value: Optional[str]) -> Optional[str]:
        return _strip_or_none(value)


class IngredientGroup(BaseModel):
    groupName: Optional[str] = Field(
        default=None, description="Opcjonalna nazwa sekcji składników po polsku."
    )
    items: list[IngredientItem] = Field(
        ..., description="Lista składników w tej grupie (co najmniej 1)."
    )

    @field_validator("groupName")
    @classmethod
    def clean_group_name(cls, value: Optional[str]) -> Optional[str]:
        return _strip_or_none(value)

    @field_validator("items")
    @classmethod
    def validate_items_non_empty(cls, value: list[IngredientItem]) -> list[IngredientItem]:
        if not value:
            raise ValueError("Ingredient group must contain at least one item.")
        return value


class RecipeStep(BaseModel):
    stepNumber: int = Field(..., description="Numer kroku (kolejno od 1).")
    title: Optional[str] = Field(
        default=None, description="Zwięzły tytuł kroku po polsku."
    )
    instruction: str = Field(
        ..., description="Przejrzysta instrukcja wykonania kroku po polsku."
    )
    tip: Optional[str] = Field(
        default=None, description="Opcjonalna wskazówka kulinarna do tego kroku."
    )
    imageUrl: Optional[str] = Field(
        default=None,
        description="Opcjonalny URL zdjęcia etapowego z listy kandydatów ilustrującego ten krok.",
    )

    @field_validator("stepNumber")
    @classmethod
    def validate_step_number(cls, value: int) -> int:
        if value < 1:
            raise ValueError("stepNumber must be >= 1.")
        return value

    @field_validator("instruction")
    @classmethod
    def validate_instruction(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Step instruction cannot be empty.")
        return cleaned

    @field_validator("title", "tip", "imageUrl")
    @classmethod
    def clean_optional_fields(cls, value: Optional[str]) -> Optional[str]:
        return _strip_or_none(value)


class Recipe(BaseModel):
    """Pydantic schema matching Astro Content Collection (`src/schemas/recipe.ts`) 100%."""

    id: Optional[str] = Field(
        default=None, description="Identyfikator przepisu (taki sam jak slug)."
    )
    slug: str = Field(..., description="Czytelny slug URL bez polskich znaków.")
    title: str = Field(..., description="Tytuł przepisu po polsku.")
    summary: str = Field(
        ..., description="Krótkie, apetyczne podsumowanie przepisu (1-2 zdania po polsku)."
    )
    category: CategoryName = Field(
        ..., description="Jedna z 6 dozwolonych kategorii książki kucharskiej."
    )
    tags: list[str] = Field(
        default_factory=list,
        description="3 do 6 krótkich polskich tagów opisujących danie.",
    )
    prepTimeMinutes: Optional[int] = Field(
        default=None, description="Czas przygotowania w minutach (>= 0)."
    )
    cookTimeMinutes: Optional[int] = Field(
        default=None, description="Czas gotowania lub pieczenia w minutach (>= 0)."
    )
    totalTimeMinutes: int = Field(
        ..., description="Całkowity czas przygotowania w minutach (>= 1)."
    )
    servings: float = Field(..., description="Liczba porcji lub sztuk (> 0).")
    difficulty: DifficultyLevel = Field(
        ..., description="Poziom trudności: Łatwy, Średni lub Wymagający."
    )
    images: list[RecipeImage] = Field(
        ..., description="Lista zdjęć potrawy (co najmniej 1, jedno z isMain=true)."
    )
    videos: list[RecipeVideo] = Field(
        default_factory=list,
        description="Lista filmów wideo z przygotowania wraz z poprawnym embedUrl.",
    )
    ingredientGroups: list[IngredientGroup] = Field(
        ..., description="Lista grup składników (co najmniej 1)."
    )
    steps: list[RecipeStep] = Field(
        ..., description="Kroki przygotowania po polsku (co najmniej 1)."
    )
    chefTips: list[str] = Field(
        default_factory=list,
        description="Praktyczne wskazówki Szefa Kuchni po polsku.",
    )
    sourceUrl: str = Field(..., description="Pełny adres URL strony źródłowej.")
    sourceDomain: str = Field(
        ..., description="Domena źródła bez prefiksu www., np. kwestiasmaku.com."
    )
    originalLanguage: str = Field(
        ..., description="Dwuliterowy kod języka źródłowego ISO 639-1, np. en, pl, it."
    )
    createdAt: str = Field(..., description="Data utworzenia w formacie ISO 8601.")

    @field_validator("id")
    @classmethod
    def clean_id(cls, value: Optional[str]) -> Optional[str]:
        return _strip_or_none(value)

    @field_validator("slug", "title", "summary", "sourceDomain")
    @classmethod
    def validate_non_empty_str(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Field cannot be empty.")
        return cleaned

    @field_validator("tags", "chefTips")
    @classmethod
    def clean_string_list(cls, values: list[str]) -> list[str]:
        return [item.strip() for item in values if item and item.strip()]

    @field_validator("prepTimeMinutes", "cookTimeMinutes")
    @classmethod
    def validate_non_negative_int(cls, value: Optional[int]) -> Optional[int]:
        if value is not None and value < 0:
            raise ValueError("Time in minutes cannot be negative.")
        return value

    @field_validator("totalTimeMinutes")
    @classmethod
    def validate_total_time(cls, value: int) -> int:
        if value < 1:
            raise ValueError("totalTimeMinutes must be >= 1.")
        return value

    @field_validator("servings")
    @classmethod
    def validate_servings(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("servings must be > 0.")
        return value

    @field_validator("sourceUrl")
    @classmethod
    def validate_source_url(cls, value: str) -> str:
        cleaned = value.strip()
        parsed = urlparse(cleaned)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("sourceUrl must be a valid HTTP(S) URL.")
        return cleaned

    @field_validator("originalLanguage")
    @classmethod
    def validate_original_language(cls, value: str) -> str:
        cleaned = value.strip().lower()
        if len(cleaned) < 2:
            raise ValueError("originalLanguage must be at least 2 characters.")
        return cleaned

    @field_validator("createdAt")
    @classmethod
    def validate_created_at(cls, value: str) -> str:
        cleaned = value.strip()
        normalized = cleaned.replace("Z", "+00:00")
        datetime.fromisoformat(normalized)
        return cleaned

    @model_validator(mode="after")
    def validate_required_collections(self) -> "Recipe":
        if not self.images:
            raise ValueError("Przepis wymaga co najmniej jednego zdjęcia.")
        if not self.ingredientGroups:
            raise ValueError("Przepis wymaga co najmniej jednej grupy składników.")
        if not self.steps:
            raise ValueError("Przepis wymaga co najmniej jednego kroku przygotowania.")
        return self


RecipeSchema = Recipe


@dataclass
class ImageCandidate:
    url: str
    source: str
    alt: str = ""
    priority: int = 10


@dataclass
class VideoCandidate:
    url: str
    platform: VideoPlatform
    embed_url: str
    title: Optional[str] = None
    source: str = ""


@dataclass
class ExtractedPageData:
    source_url: str
    final_url: str
    language_hint: Optional[str]
    json_ld_recipes: list[dict[str, Any]]
    image_candidates: list[ImageCandidate]
    video_candidates: list[VideoCandidate]
    html_article_text: str
    jina_markdown: str


def log_info(message: str) -> None:
    print(f"[INFO] {message}", file=sys.stderr)


def log_warn(message: str) -> None:
    print(f"[WARN] {message}", file=sys.stderr)


def validate_input_url(raw_url: str) -> str:
    cleaned = raw_url.strip()
    parsed = urlparse(cleaned)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"Nieprawidłowy adres URL: {raw_url!r}")
    return cleaned


def extract_source_domain(url: str) -> str:
    netloc = urlparse(url).netloc.lower()
    host = netloc.split("@")[-1].split(":")[0]
    return host.removeprefix("www.")


def normalize_url(raw_url: Optional[str], base_url: str) -> Optional[str]:
    if not raw_url:
        return None
    candidate = raw_url.strip()
    if not candidate:
        return None
    lowered = candidate.lower()
    if lowered.startswith(("data:", "javascript:", "mailto:", "tel:", "#")):
        return None
    resolved = urljoin(base_url, candidate)
    parsed = urlparse(resolved)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return resolved


def parse_positive_int(value: Any) -> Optional[int]:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        parsed = int(value)
        return parsed if parsed > 0 else None
    text = str(value).strip().lower()
    if not text or "%" in text or text == "auto":
        return None
    match = re.match(r"^(\d+(?:\.\d+)?)\s*(?:px)?$", text)
    if not match:
        return None
    parsed = int(float(match.group(1)))
    return parsed if parsed > 0 else None


def is_valid_image_candidate(
    url: str,
    *,
    width: Optional[int] = None,
    height: Optional[int] = None,
    alt: str = "",
    classes: str = "",
    strict_dimensions: bool = True,
) -> bool:
    parsed = urlparse(url)
    path_lower = parsed.path.lower()

    if path_lower.endswith((".svg", ".ico")):
        return False

    if strict_dimensions:
        if width is not None and width < MIN_IMAGE_DIMENSION_PX:
            return False
        if height is not None and height < MIN_IMAGE_DIMENSION_PX:
            return False

        dim_match = URL_DIM_SUFFIX_RE.search(path_lower)
        if dim_match:
            w_url, h_url = int(dim_match.group(1)), int(dim_match.group(2))
            if w_url < MIN_IMAGE_DIMENSION_PX or h_url < MIN_IMAGE_DIMENSION_PX:
                return False

        query = parse_qs(parsed.query)
        for key in ("w", "width", "h", "height"):
            for val in query.get(key, []):
                num = parse_positive_int(val)
                if num is not None and num < MIN_IMAGE_DIMENSION_PX:
                    return False

    if IMAGE_NOISE_PATH_RE.search(path_lower):
        return False

    filename = path_lower.rsplit("/", 1)[-1]
    if IMAGE_NOISE_TOKEN_RE.search(filename):
        return False
    if classes and IMAGE_NOISE_TOKEN_RE.search(classes):
        return False
    if alt and IMAGE_NOISE_TOKEN_RE.search(alt):
        return False

    return True


def parse_srcset_best(srcset_value: str, base_url: str) -> Optional[str]:
    candidates: list[tuple[float, str]] = []
    for entry in srcset_value.split(","):
        parts = entry.strip().split()
        if not parts:
            continue
        url = normalize_url(parts[0], base_url)
        if not url:
            continue
        score = 1.0
        if len(parts) > 1:
            descriptor = parts[1].strip().lower()
            if descriptor.endswith("w") and descriptor[:-1].isdigit():
                width_val = int(descriptor[:-1])
                if width_val < MIN_IMAGE_DIMENSION_PX:
                    continue
                score = float(width_val)
            elif descriptor.endswith("x"):
                try:
                    score = float(descriptor[:-1]) * 1000.0
                except ValueError:
                    pass
        candidates.append((score, url))

    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1]


def normalize_video_url(
    raw_url: str,
    base_url: str,
    *,
    title: Optional[str] = None,
    source: str = "",
) -> Optional[VideoCandidate]:
    abs_url = normalize_url(raw_url, base_url)
    if not abs_url:
        return None

    parsed = urlparse(abs_url)
    host = parsed.netloc.lower().removeprefix("www.")
    path = parsed.path

    # YouTube
    if host in {"youtu.be", "youtube.com", "m.youtube.com", "youtube-nocookie.com"}:
        video_id: Optional[str] = None
        is_short = "/shorts/" in path.lower()
        segments = [seg for seg in path.split("/") if seg]

        if host == "youtu.be" and segments:
            video_id = segments[0]
        else:
            qs = parse_qs(parsed.query)
            if qs.get("v"):
                video_id = qs["v"][0]
            elif len(segments) >= 2 and segments[0].lower() in {
                "embed",
                "shorts",
                "live",
                "v",
            }:
                video_id = segments[1]

        if video_id and YOUTUBE_ID_RE.match(video_id) and video_id.lower() != "videoseries":
            canonical_url = (
                f"https://www.youtube.com/shorts/{video_id}"
                if is_short
                else f"https://www.youtube.com/watch?v={video_id}"
            )
            return VideoCandidate(
                url=canonical_url,
                platform="youtube",
                embed_url=f"https://www.youtube-nocookie.com/embed/{video_id}",
                title=_strip_or_none(title),
                source=source,
            )
        return None

    # Instagram
    ig_match = INSTAGRAM_RE.search(abs_url)
    if ig_match:
        raw_kind, shortcode = ig_match.group(1).lower(), ig_match.group(2)
        kind = "reel" if raw_kind == "reels" else raw_kind
        return VideoCandidate(
            url=f"https://www.instagram.com/{kind}/{shortcode}/",
            platform="instagram",
            embed_url=f"https://www.instagram.com/{kind}/{shortcode}/embed",
            title=_strip_or_none(title),
            source=source,
        )

    # TikTok
    tt_match = TIKTOK_VIDEO_RE.search(abs_url)
    if tt_match:
        video_id = tt_match.group(1)
        clean_original = abs_url.split("?", 1)[0] if "/@" in abs_url else (
            f"https://www.tiktok.com/embed/v2/{video_id}"
        )
        return VideoCandidate(
            url=clean_original,
            platform="tiktok",
            embed_url=f"https://www.tiktok.com/embed/v2/{video_id}",
            title=_strip_or_none(title),
            source=source,
        )

    # Direct MP4
    if parsed.path.lower().endswith(".mp4"):
        return VideoCandidate(
            url=abs_url,
            platform="mp4",
            embed_url=abs_url,
            title=_strip_or_none(title),
            source=source,
        )

    return None


def _is_recipe_type(type_value: Any) -> bool:
    if isinstance(type_value, str):
        return type_value.rsplit("/", 1)[-1].lower() == "recipe"
    if isinstance(type_value, list):
        return any(_is_recipe_type(item) for item in type_value)
    return False


def _is_video_type(type_value: Any) -> bool:
    if isinstance(type_value, str):
        return type_value.rsplit("/", 1)[-1].lower() == "videoobject"
    if isinstance(type_value, list):
        return any(_is_video_type(item) for item in type_value)
    return False


def _index_jsonld_ids(node: Any, id_map: dict[str, dict[str, Any]]) -> None:
    if isinstance(node, dict):
        node_id = node.get("@id")
        if isinstance(node_id, str) and node_id.strip() and len(node) > 1:
            id_map[node_id.strip()] = node
        for val in node.values():
            _index_jsonld_ids(val, id_map)
    elif isinstance(node, list):
        for item in node:
            _index_jsonld_ids(item, id_map)


def _resolve_jsonld_refs(
    node: Any, id_map: dict[str, dict[str, Any]], depth: int = 0, seen: Optional[set[str]] = None
) -> Any:
    if depth > 6:
        return node
    if seen is None:
        seen = set()

    if isinstance(node, list):
        return [_resolve_jsonld_refs(item, id_map, depth + 1, seen) for item in node]

    if isinstance(node, dict):
        if set(node.keys()) == {"@id"} and isinstance(node.get("@id"), str):
            ref_id = node["@id"].strip()
            if ref_id in id_map and ref_id not in seen:
                next_seen = seen | {ref_id}
                return _resolve_jsonld_refs(id_map[ref_id], id_map, depth + 1, next_seen)
        return {
            key: _resolve_jsonld_refs(val, id_map, depth + 1, seen)
            for key, val in node.items()
        }

    return node


def _collect_jsonld_nodes(
    node: Any,
    recipes: list[dict[str, Any]],
    videos: list[dict[str, Any]],
) -> None:
    if isinstance(node, list):
        for item in node:
            _collect_jsonld_nodes(item, recipes, videos)
    elif isinstance(node, dict):
        node_type = node.get("@type")
        if _is_recipe_type(node_type):
            recipes.append(node)
        elif _is_video_type(node_type):
            videos.append(node)
        for key, val in node.items():
            if key != "@context":
                _collect_jsonld_nodes(val, recipes, videos)


def _extract_images_from_jsonld_field(
    field: Any, base_url: str, out: list[ImageCandidate]
) -> None:
    if isinstance(field, str):
        abs_url = normalize_url(field, base_url)
        if abs_url and is_valid_image_candidate(abs_url):
            out.append(ImageCandidate(url=abs_url, source="jsonld", priority=1))
    elif isinstance(field, list):
        for item in field:
            _extract_images_from_jsonld_field(item, base_url, out)
    elif isinstance(field, dict):
        raw_url = field.get("url") or field.get("contentUrl")
        if isinstance(raw_url, list) and raw_url:
            raw_url = raw_url[0]
        if isinstance(raw_url, str):
            abs_url = normalize_url(raw_url, base_url)
            width = parse_positive_int(field.get("width"))
            height = parse_positive_int(field.get("height"))
            caption = field.get("caption") or field.get("name") or ""
            if abs_url and is_valid_image_candidate(
                abs_url, width=width, height=height, alt=str(caption)
            ):
                out.append(
                    ImageCandidate(
                        url=abs_url,
                        source="jsonld",
                        alt=str(caption).strip(),
                        priority=1,
                    )
                )


def _extract_videos_from_jsonld_obj(
    video_obj: Any, base_url: str, source: str, out: list[VideoCandidate]
) -> None:
    if isinstance(video_obj, list):
        for item in video_obj:
            _extract_videos_from_jsonld_obj(item, base_url, source, out)
    elif isinstance(video_obj, str):
        cand = normalize_video_url(video_obj, base_url, source=source)
        if cand:
            out.append(cand)
    elif isinstance(video_obj, dict):
        title = video_obj.get("name") or video_obj.get("description")
        title_str = str(title).strip() if isinstance(title, str) else None
        for key in ("embedUrl", "contentUrl", "url"):
            raw = video_obj.get(key)
            if isinstance(raw, str):
                cand = normalize_video_url(raw, base_url, title=title_str, source=source)
                if cand:
                    out.append(cand)


def _is_noise_tag(tag: Tag) -> bool:
    if tag.name in NOISE_ANCESTOR_TAGS:
        return True
    classes = " ".join(tag.get("class") or [])
    elem_id = str(tag.get("id") or "")
    combined = f"{classes} {elem_id}".strip()
    return bool(combined and NOISE_ATTR_RE.search(combined))


def _find_article_root(soup: BeautifulSoup) -> Tag:
    selectors = (
        "article",
        "main",
        "[role='main']",
        ".entry-content",
        ".post-content",
        ".recipe-content",
        ".wprm-recipe-container",
        ".tasty-recipes",
        "#content",
    )
    fallback_candidate: Optional[Tag] = None
    for selector in selectors:
        best_for_selector: Optional[Tag] = None
        best_len = 0
        for candidate in soup.select(selector):
            if _is_noise_tag(candidate) or _has_noise_ancestor(candidate, soup):
                continue
            text_len = len(candidate.get_text(" ", strip=True))
            if text_len > best_len:
                best_for_selector = candidate
                best_len = text_len
        if best_for_selector is not None:
            if best_len >= 250:
                return best_for_selector
            if fallback_candidate is None:
                fallback_candidate = best_for_selector
    return fallback_candidate or soup.body or soup


def _has_noise_ancestor(tag: Tag, root: Tag) -> bool:
    current = tag.parent
    while current is not None and current is not root:
        if current.name in NOISE_ANCESTOR_TAGS:
            return True
        if current.name == "header" and root.name not in {"article", "main"}:
            return True
        if _is_noise_tag(current):
            return True
        current = current.parent
    return False


def _extract_img_url_from_tag(img: Tag, base_url: str) -> Optional[str]:
    for attr in ("data-srcset", "srcset"):
        val = img.get(attr)
        if isinstance(val, str) and val.strip():
            best = parse_srcset_best(val, base_url)
            if best:
                return best

    parent = img.parent
    if isinstance(parent, Tag) and parent.name == "picture":
        for source_tag in parent.find_all("source"):
            for attr in ("data-srcset", "srcset"):
                val = source_tag.get(attr)
                if isinstance(val, str) and val.strip():
                    best = parse_srcset_best(val, base_url)
                    if best:
                        return best

    for attr in (
        "data-hi-res-src",
        "data-full-src",
        "data-original",
        "data-lazy-src",
        "data-src",
        "data-lazy",
        "data-url",
        "src",
    ):
        val = img.get(attr)
        if isinstance(val, str):
            abs_url = normalize_url(val, base_url)
            if abs_url:
                return abs_url
    return None


def _extract_article_text(soup: BeautifulSoup) -> str:
    root = _find_article_root(soup)
    clone = BeautifulSoup(str(root), "html.parser")
    for tag in clone.find_all(["script", "style", "noscript", "svg", "nav", "footer", "aside"]):
        tag.decompose()
    for elem in clone.find_all(True):
        if elem.parent is clone or not getattr(elem, "attrs", None):
            continue
        if _is_noise_tag(elem):
            elem.decompose()
    lines = [line.strip() for line in clone.get_text("\n").splitlines()]
    return "\n".join(line for line in lines if line)


def _dedupe_images(candidates: Sequence[ImageCandidate]) -> list[ImageCandidate]:
    by_url: dict[str, ImageCandidate] = {}
    for cand in candidates:
        existing = by_url.get(cand.url)
        if existing is None:
            by_url[cand.url] = cand
        else:
            if cand.priority < existing.priority:
                existing.priority = cand.priority
                existing.source = cand.source
            if cand.alt and not existing.alt:
                existing.alt = cand.alt
    ordered = sorted(by_url.values(), key=lambda item: item.priority)
    return ordered[:MAX_IMAGE_CANDIDATES]


def _dedupe_videos(candidates: Sequence[VideoCandidate]) -> list[VideoCandidate]:
    by_key: dict[tuple[str, str], VideoCandidate] = {}
    for cand in candidates:
        key = (cand.platform, cand.embed_url)
        existing = by_key.get(key)
        if existing is None:
            by_key[key] = cand
        else:
            if cand.title and not existing.title:
                existing.title = cand.title
            if "/watch?v=" in existing.url and "/shorts/" in cand.url:
                existing.url = cand.url
    return list(by_key.values())


def _collect_images_from_container(
    container: Tag, base_url: str, source_label: str
) -> list[ImageCandidate]:
    found: list[ImageCandidate] = []
    for img in container.find_all("img"):
        if _has_noise_ancestor(img, container):
            continue
        img_url = _extract_img_url_from_tag(img, base_url)
        if not img_url:
            continue
        width = parse_positive_int(img.get("width"))
        height = parse_positive_int(img.get("height"))
        alt = str(img.get("alt") or "").strip()
        classes = " ".join(img.get("class") or [])
        if is_valid_image_candidate(
            img_url, width=width, height=height, alt=alt, classes=classes
        ):
            found.append(
                ImageCandidate(url=img_url, source=source_label, alt=alt, priority=3)
            )
    return found


CHALLENGE_TITLE_MARKERS: tuple[str, ...] = (
    "just a moment...",
    "attention required! | cloudflare",
    "403 forbidden",
    "access denied",
)
CHALLENGE_BODY_MARKERS: tuple[str, ...] = (
    "warning: target url returned error",
    "just a moment...",
    "enable javascript and cookies to continue",
    "performing security verification",
    "verify you are human",
    "attention required! | cloudflare",
)


def _is_challenge_or_error_text(text: str, title: str = "") -> bool:
    """Detect short anti-bot challenge or HTTP error pages instead of real recipe content."""
    lowered_title = title.strip().lower()
    if lowered_title in CHALLENGE_TITLE_MARKERS:
        return True

    stripped = text.strip()
    if not stripped:
        return True

    lowered = stripped.lower()
    if len(stripped) < 2500 and any(marker in lowered for marker in CHALLENGE_BODY_MARKERS):
        return True
    if len(stripped) < 800 and "access denied" in lowered:
        return True
    return False


def parse_html_document(
    raw_html: bytes | str, source_url: str, final_url: str
) -> dict[str, Any]:
    """Parse raw HTML into JSON-LD recipes, images, videos, language hint, and cleaned text."""
    soup = BeautifulSoup(raw_html, "html.parser")

    base_tag = soup.find("base", href=True)
    base_url = normalize_url(str(base_tag["href"]), final_url) if base_tag else final_url
    base_url = base_url or final_url

    title_tag = soup.find("title")
    page_title = title_tag.get_text(" ", strip=True) if title_tag else ""

    html_tag = soup.find("html")
    lang_hint: Optional[str] = None
    if html_tag and html_tag.get("lang"):
        lang_hint = str(html_tag["lang"]).strip()[:10]

    json_ld_recipes: list[dict[str, Any]] = []
    json_ld_videos: list[dict[str, Any]] = []
    raw_parsed_blocks: list[Any] = []
    id_map: dict[str, dict[str, Any]] = {}

    for script in soup.find_all("script", attrs={"type": re.compile(r"application/ld\+json", re.I)}):
        raw_text = (script.string or script.get_text() or "").strip()
        if not raw_text:
            continue
        raw_text = re.sub(r"^\s*<!--|--!?>\s*$", "", raw_text).strip()
        try:
            parsed = json.loads(raw_text, strict=False)
        except json.JSONDecodeError:
            continue
        raw_parsed_blocks.append(parsed)
        _index_jsonld_ids(parsed, id_map)

    for parsed in raw_parsed_blocks:
        resolved_block = _resolve_jsonld_refs(parsed, id_map)
        _collect_jsonld_nodes(resolved_block, json_ld_recipes, json_ld_videos)

    images: list[ImageCandidate] = []
    videos: list[VideoCandidate] = []

    for recipe_obj in json_ld_recipes:
        if "image" in recipe_obj:
            _extract_images_from_jsonld_field(recipe_obj["image"], base_url, images)
        if "video" in recipe_obj:
            _extract_videos_from_jsonld_obj(
                recipe_obj["video"], base_url, "jsonld_recipe", videos
            )

    for vid_obj in json_ld_videos:
        _extract_videos_from_jsonld_obj(vid_obj, base_url, "jsonld_graph", videos)

    # Meta og:image & twitter:image
    meta_selectors = (
        ("meta[property='og:image:secure_url']", "og:image"),
        ("meta[property='og:image']", "og:image"),
        ("meta[name='twitter:image']", "twitter:image"),
        ("meta[itemprop='image']", "itemprop:image"),
    )
    for selector, label in meta_selectors:
        for tag in soup.select(selector):
            content = tag.get("content")
            if isinstance(content, str):
                abs_url = normalize_url(content, base_url)
                if abs_url and is_valid_image_candidate(abs_url):
                    images.append(ImageCandidate(url=abs_url, source=label, priority=2))

    # Article <img> tags (fallback to <body> if article root yielded no images)
    article_root = _find_article_root(soup)
    article_images = _collect_images_from_container(article_root, base_url, "article-img")
    if not article_images and soup.body is not None and article_root is not soup.body:
        article_images = _collect_images_from_container(soup.body, base_url, "body-img")
    images.extend(article_images)

    # Embedded videos from HTML (iframes, video/source, blockquotes, links)
    for iframe in soup.find_all("iframe"):
        raw_title = iframe.get("title")
        iframe_title = str(raw_title).strip() if raw_title else None
        for attr in ("src", "data-src", "data-lazy-src"):
            raw = iframe.get(attr)
            if isinstance(raw, str):
                cand = normalize_video_url(
                    raw, base_url, title=iframe_title, source="iframe"
                )
                if cand:
                    videos.append(cand)

    for video_tag in soup.find_all("video"):
        for attr in ("src", "data-src"):
            raw = video_tag.get(attr)
            if isinstance(raw, str):
                cand = normalize_video_url(raw, base_url, source="video-tag")
                if cand:
                    videos.append(cand)
        for source_tag in video_tag.find_all("source"):
            for attr in ("src", "data-src"):
                raw = source_tag.get(attr)
                if isinstance(raw, str):
                    cand = normalize_video_url(raw, base_url, source="video-source")
                    if cand:
                        videos.append(cand)

    for ig_quote in soup.select("blockquote.instagram-media[data-instgrm-permalink]"):
        raw = ig_quote.get("data-instgrm-permalink")
        if isinstance(raw, str):
            cand = normalize_video_url(raw, base_url, source="instagram-blockquote")
            if cand:
                videos.append(cand)

    for tt_quote in soup.select("blockquote.tiktok-embed"):
        raw = tt_quote.get("cite")
        if isinstance(raw, str):
            cand = normalize_video_url(raw, base_url, source="tiktok-blockquote")
            if cand:
                videos.append(cand)
        elif tt_quote.get("data-video-id"):
            vid = str(tt_quote["data-video-id"]).strip()
            if vid.isdigit():
                videos.append(
                    VideoCandidate(
                        url=f"https://www.tiktok.com/embed/v2/{vid}",
                        platform="tiktok",
                        embed_url=f"https://www.tiktok.com/embed/v2/{vid}",
                        source="tiktok-blockquote",
                    )
                )

    for anchor in article_root.find_all("a", href=True):
        if _has_noise_ancestor(anchor, article_root):
            continue
        href = anchor.get("href")
        if isinstance(href, str):
            anchor_text = anchor.get_text(" ", strip=True)
            cand = normalize_video_url(
                href, base_url, title=anchor_text or None, source="article-link"
            )
            if cand:
                videos.append(cand)

    return {
        "source_url": source_url,
        "final_url": final_url,
        "page_title": page_title,
        "language_hint": lang_hint,
        "json_ld_recipes": json_ld_recipes,
        "images": images,
        "videos": videos,
        "article_text": _extract_article_text(soup),
    }


def extract_from_html(url: str) -> Optional[dict[str, Any]]:
    """Step A: Scrape HTML via requests + BeautifulSoup for JSON-LD, images, videos, and fallback text."""
    try:
        response = requests.get(
            url,
            headers=BROWSER_HEADERS,
            timeout=REQUEST_TIMEOUT_HTML,
            allow_redirects=True,
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        log_warn(f"Krok A (bezpośredni scraping HTML) nie powiódł się: {exc}")
        return None

    parsed = parse_html_document(response.content, url, response.url or url)
    if not parsed["json_ld_recipes"] and _is_challenge_or_error_text(
        parsed["article_text"], parsed["page_title"]
    ):
        log_warn("Krok A zwrócił stronę blokady lub błędu zamiast treści przepisu.")
        return None
    return parsed


def _request_jina(
    url: str, headers: dict[str, str], timeout: int, label: str
) -> Optional[requests.Response]:
    """Fetch a URL via r.jina.ai with short retries for transient rate-limit/5xx errors."""
    jina_url = f"https://r.jina.ai/{url}"
    total_attempts = 1 + len(JINA_RETRY_DELAYS_SECONDS)

    for attempt in range(total_attempts):
        try:
            response = requests.get(
                jina_url,
                headers=headers,
                timeout=timeout,
            )
            if (
                response.status_code in JINA_TRANSIENT_STATUS_CODES
                and attempt < len(JINA_RETRY_DELAYS_SECONDS)
            ):
                wait_s = JINA_RETRY_DELAYS_SECONDS[attempt]
                log_warn(
                    f"{label} zwrócił tymczasowy status HTTP {response.status_code}. "
                    f"Ponowienie za {wait_s:.1f}s..."
                )
                time.sleep(wait_s)
                continue
            response.raise_for_status()
            return response
        except (requests.Timeout, requests.ConnectionError) as exc:
            if attempt < len(JINA_RETRY_DELAYS_SECONDS):
                wait_s = JINA_RETRY_DELAYS_SECONDS[attempt]
                log_warn(f"{label} błąd połączenia: {exc}. Ponowienie za {wait_s:.1f}s...")
                time.sleep(wait_s)
                continue
            log_warn(f"{label} nie powiódł się: {exc}")
            return None
        except requests.RequestException as exc:
            log_warn(f"{label} nie powiódł się: {exc}")
            return None

    return None


def _fetch_jina_html_with_status(
    url: str,
) -> tuple[Optional[dict[str, Any]], Optional[int]]:
    """Fetch rendered HTML via r.jina.ai JSON mode and return (parsed_data, target_http_status)."""
    response = _request_jina(
        url, JINA_HTML_HEADERS, REQUEST_TIMEOUT_JINA, "Krok B-HTML (r.jina.ai)"
    )
    if response is None:
        return None, None

    try:
        payload = response.json()
    except ValueError as exc:
        log_warn(f"Krok B-HTML (r.jina.ai) zwrócił niepoprawny JSON: {exc}")
        return None, None

    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        log_warn("Krok B-HTML (r.jina.ai) zwrócił pusty obiekt danych.")
        return None, None

    http_status = data.get("httpStatus")
    target_status = http_status if isinstance(http_status, int) else None
    if target_status is not None and target_status >= 400:
        log_warn(
            f"Krok B-HTML (r.jina.ai) otrzymał status HTTP {target_status} ze strony źródłowej."
        )
        return None, target_status

    raw_html = data.get("html")
    if not isinstance(raw_html, str) or not raw_html.strip():
        return None, target_status

    final_url = str(data.get("finalUrl") or url).strip() or url
    parsed = parse_html_document(raw_html, url, final_url)
    if not parsed["json_ld_recipes"] and _is_challenge_or_error_text(
        parsed["article_text"], parsed["page_title"]
    ):
        log_warn("Krok B-HTML (r.jina.ai) otrzymał stronę blokady zamiast przepisu.")
        return None, target_status
    return parsed, target_status


def fetch_jina_html(url: str) -> Optional[dict[str, Any]]:
    """Fetch rendered HTML via r.jina.ai JSON mode to recover JSON-LD, og:image, and video embeds."""
    parsed, _ = _fetch_jina_html_with_status(url)
    return parsed


def fetch_jina_markdown(url: str) -> Optional[str]:
    """Step B: Fetch clean markdown representation via r.jina.ai as support/fallback."""
    response = _request_jina(
        url, JINA_HEADERS, REQUEST_TIMEOUT_JINA, "Krok B (r.jina.ai)"
    )
    if response is None:
        return None
    text = response.text.strip()
    return text if text else None


def _extract_media_from_markdown(
    markdown_text: str, base_url: str, source_url: Optional[str] = None
) -> tuple[list[ImageCandidate], list[VideoCandidate]]:
    images: list[ImageCandidate] = []
    videos: list[VideoCandidate] = []
    page_urls = {base_url.rstrip("/")}
    if source_url:
        page_urls.add(source_url.rstrip("/"))

    for alt, raw_url in MARKDOWN_IMAGE_RE.findall(markdown_text):
        abs_url = normalize_url(raw_url, base_url)
        if not abs_url or abs_url.rstrip("/") in page_urls:
            continue
        if is_valid_image_candidate(abs_url, alt=alt):
            images.append(
                ImageCandidate(
                    url=abs_url,
                    source="jina-markdown",
                    alt=alt.strip(),
                    priority=4,
                )
            )

    for raw_url in RAW_URL_RE.findall(markdown_text):
        cleaned = raw_url.rstrip(".,;:!?")
        cand = normalize_video_url(cleaned, base_url, source="jina-markdown")
        if cand:
            videos.append(cand)

    return images, videos


def collect_page_data(url: str) -> ExtractedPageData:
    """Run dual-track extraction (HTML + Jina Reader) and combine media & text."""
    log_info(f"Pobieranie danych (Krok A - HTML): {url}")
    html_data = extract_from_html(url)

    needs_jina_html = html_data is None or (
        not html_data["json_ld_recipes"] and len(html_data["article_text"]) < 250
    )
    if needs_jina_html:
        log_info(f"Pobieranie wyrenderowanego HTML (Krok B-HTML - r.jina.ai): {url}")
        jina_html_data, jina_http_status = _fetch_jina_html_with_status(url)
        if html_data is None and jina_http_status in {404, 410}:
            raise RuntimeError(
                f"Strona źródłowa nie istnieje lub została usunięta (HTTP {jina_http_status})."
            )
        if jina_html_data is not None and (
            html_data is None
            or jina_html_data["json_ld_recipes"]
            or len(jina_html_data["article_text"]) > len(html_data["article_text"])
        ):
            html_data = jina_html_data

    log_info(f"Pobieranie czystego tekstu (Krok B - r.jina.ai): {url}")
    jina_text = fetch_jina_markdown(url)
    usable_jina = (
        jina_text if jina_text and not _is_challenge_or_error_text(jina_text) else None
    )

    if html_data is None and not usable_jina:
        raise RuntimeError(
            "Nie udało się pobrać treści ani przez bezpośredni scraping HTML, "
            "ani przez r.jina.ai."
        )

    final_url = html_data["final_url"] if html_data else url
    images: list[ImageCandidate] = list(html_data["images"]) if html_data else []
    videos: list[VideoCandidate] = list(html_data["videos"]) if html_data else []

    if usable_jina:
        jina_images, jina_videos = _extract_media_from_markdown(
            usable_jina, final_url, source_url=url
        )
        images.extend(jina_images)
        if not videos:
            videos.extend(jina_videos)

    deduped_images = _dedupe_images(images)
    deduped_videos = _dedupe_videos(videos)

    return ExtractedPageData(
        source_url=url,
        final_url=final_url,
        language_hint=html_data["language_hint"] if html_data else None,
        json_ld_recipes=html_data["json_ld_recipes"] if html_data else [],
        image_candidates=deduped_images,
        video_candidates=deduped_videos,
        html_article_text=html_data["article_text"] if html_data else "",
        jina_markdown=usable_jina or "",
    )


def _compact_jsonld_recipes(recipes: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """Strip bulky non-recipe metadata (e.g., user reviews) so instructions are not truncated."""
    ignored_keys = {"review", "aggregateRating", "potentialAction"}
    return [
        {key: val for key, val in recipe.items() if key not in ignored_keys}
        for recipe in recipes
    ]


def build_prompt(
    data: ExtractedPageData,
    max_text_chars: int = FULL_PROMPT_TEXT_CHARS,
) -> str:
    sections: list[str] = [
        f"URL źródłowy: {data.source_url}",
        f"Domena źródłowa: {extract_source_domain(data.source_url)}",
    ]
    if data.language_hint:
        sections.append(f"Wykryty atrybut języka strony: {data.language_hint}")

    if data.json_ld_recipes:
        compact_recipes = _compact_jsonld_recipes(data.json_ld_recipes)
        jsonld_str = json.dumps(compact_recipes, ensure_ascii=False)
        sections.append(f"=== DANE STRUKTURALNE JSON-LD (Schema.org Recipe) ===\n{jsonld_str}")

    if data.image_candidates:
        img_lines = []
        for idx, img in enumerate(data.image_candidates, start=1):
            alt_info = f" | alt: {img.alt}" if img.alt else ""
            img_lines.append(f"{idx}. [{img.source}] {img.url}{alt_info}")
        sections.append("=== DOSTĘPNE KANDYDATY ZDJĘĆ (wybierz wyłącznie z tej listy) ===\n" + "\n".join(img_lines))
    else:
        sections.append("=== DOSTĘPNE KANDYDATY ZDJĘĆ ===\nBrak wykrytych zdjęć.")

    if data.video_candidates:
        vid_lines = []
        for idx, vid in enumerate(data.video_candidates, start=1):
            title_info = f" | tytuł: {vid.title}" if vid.title else ""
            vid_lines.append(
                f"{idx}. [{vid.platform} | {vid.source}] url={vid.url} | embedUrl={vid.embed_url}{title_info}"
            )
        sections.append("=== WYKRYTE MATERIAŁY WIDEO ===\n" + "\n".join(vid_lines))
    else:
        sections.append("=== WYKRYTE MATERIAŁY WIDEO ===\nBrak wykrytych filmów.")

    jina_text = data.jina_markdown
    html_text = data.html_article_text
    if jina_text and html_text:
        if len(jina_text) < 2000:
            combined_text = f"{jina_text}\n\n--- TEKST Z HTML ---\n{html_text}"
        elif len(jina_text) > max_text_chars and len(html_text) >= 500:
            # Prefer noise-stripped HTML article text when raw Jina markdown exceeds budget
            combined_text = html_text
        else:
            combined_text = jina_text
    else:
        combined_text = jina_text or html_text

    if combined_text:
        trimmed = combined_text[:max_text_chars]
        sections.append(f"=== WYCZYSZCZONA TREŚĆ STRONY ===\n{trimmed}")

    return "\n\n".join(sections)


def build_groq_prompt(data: ExtractedPageData) -> str:
    """Build a compact prompt for Groq Cloud under ~7 500 chars (total with system <= 11 000 chars)."""
    sections: list[str] = [
        f"URL źródłowy: {data.source_url}",
        f"Domena źródłowa: {extract_source_domain(data.source_url)}",
    ]
    if data.language_hint:
        sections.append(f"Wykryty atrybut języka strony: {data.language_hint}")

    has_recipe_jsonld = bool(data.json_ld_recipes)

    if has_recipe_jsonld:
        compact_recipes = _compact_jsonld_recipes(data.json_ld_recipes)
        jsonld_str = json.dumps(compact_recipes, ensure_ascii=False)
        sections.append(f"=== DANE STRUKTURALNE JSON-LD (Schema.org Recipe) ===\n{jsonld_str}")

    if data.image_candidates:
        img_lines = []
        for idx, img in enumerate(data.image_candidates[:12], start=1):
            alt_info = f" | alt: {img.alt}" if img.alt else ""
            img_lines.append(f"{idx}. [{img.source}] {img.url}{alt_info}")
        sections.append(
            "=== DOSTĘPNE KANDYDATY ZDJĘĆ (wybierz wyłącznie z tej listy) ===\n" + "\n".join(img_lines)
        )
    else:
        sections.append("=== DOSTĘPNE KANDYDATY ZDJĘĆ ===\nBrak wykrytych zdjęć.")

    if data.video_candidates:
        vid_lines = []
        for idx, vid in enumerate(data.video_candidates[:5], start=1):
            title_info = f" | tytuł: {vid.title}" if vid.title else ""
            vid_lines.append(
                f"{idx}. [{vid.platform} | {vid.source}] url={vid.url} | embedUrl={vid.embed_url}{title_info}"
            )
        sections.append("=== WYKRYTE MATERIAŁY WIDEO ===\n" + "\n".join(vid_lines))
    else:
        sections.append("=== WYKRYTE MATERIAŁY WIDEO ===\nBrak wykrytych filmów.")

    if not has_recipe_jsonld:
        raw_text = data.jina_markdown or data.html_article_text
        if raw_text:
            trimmed = raw_text[:GROQ_FALLBACK_TEXT_CHARS]
            sections.append(f"=== WYCZYSZCZONA TREŚĆ STRONY ===\n{trimmed}")

    return "\n\n".join(sections)


def _prepare_groq_prompt(prompt: str) -> str:
    """Ensure prompt for Groq stays compact: omit page text if JSON-LD exists, or cap to 6500 chars."""
    jsonld_marker = "=== DANE STRUKTURALNE JSON-LD (Schema.org Recipe) ==="
    text_marker = "=== WYCZYSZCZONA TREŚĆ STRONY ===\n"

    idx_text = prompt.find(text_marker)
    if idx_text == -1:
        return prompt

    if jsonld_marker in prompt:
        return prompt[:idx_text].rstrip()

    prefix = prompt[: idx_text + len(text_marker)]
    body = prompt[idx_text + len(text_marker) :]
    if len(body) <= GROQ_FALLBACK_TEXT_CHARS:
        return prompt
    return prefix + body[:GROQ_FALLBACK_TEXT_CHARS]


def _truncate_prompt_article_text(prompt: str, max_text_chars: int) -> str:
    """Ensure fallback callers passing a full prompt still respect Groq's article text cap."""
    marker = "=== WYCZYSZCZONA TREŚĆ STRONY ===\n"
    idx = prompt.find(marker)
    if idx == -1:
        return prompt
    prefix = prompt[: idx + len(marker)]
    article_body = prompt[idx + len(marker) :]
    if len(article_body) <= max_text_chars:
        return prompt
    return prefix + article_body[:max_text_chars]


def _strip_code_fences(raw_text: str) -> str:
    cleaned = re.sub(r"<think>.*?</think>", "", raw_text, flags=re.DOTALL).strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()


def _extract_json_block(raw_text: str) -> str:
    """Strip code fences, thinking tags, and extract the outermost JSON object if needed."""
    cleaned = _strip_code_fences(raw_text)
    try:
        json.loads(cleaned)
        return cleaned
    except Exception:
        pass
    first_brace = cleaned.find("{")
    last_brace = cleaned.rfind("}")
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        return cleaned[first_brace : last_brace + 1]
    return cleaned


def _prepare_openrouter_prompt(prompt: str) -> str:
    """Ensure prompt for OpenRouter trims article text to at most 20,000 characters."""
    return _truncate_prompt_article_text(prompt, OPENROUTER_PROMPT_TEXT_CHARS)


def _build_openrouter_system_instruction() -> str:
    """Build system instruction with schema rules and example JSON structure for OpenRouter."""
    current_utc = (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )
    return (
        f"{SYSTEM_INSTRUCTION}\n\n"
        "WYMAGANY FORMAT WYJŚCIOWY (JSON):\n"
        "Zwróć WYŁĄCZNIE jeden poprawny obiekt JSON ściśle zgodny ze strukturą poniższego wzorca "
        "(bez bloków markdown ```json, bez komentarzy i bez dodatkowego tekstu poza JSON-em).\n"
        "Pola `sourceUrl` i `sourceDomain` przepisz dokładnie z danych wejściowych, "
        f"`id` ustaw tak samo jak `slug`, a w `createdAt` wpisz datę ISO 8601 (np. \"{current_utc}\").\n"
        f"Wzorcowa struktura JSON (RecipeSchema):\n{GROQ_RECIPE_EXAMPLE_JSON}"
    )


GROQ_SYSTEM_INSTRUCTION = """Jesteś redaktorem książki kucharskiej "Ulubione przepisy Kasi".
Przekształć surowe dane ze strony w dopracowany przepis w formacie JSON zgodny ze wzorcem.
Zasady redakcyjne:
1. Język wyłącznie polski (przetłumacz w całości obcojęzyczne źródła).
2. Jednostki metryczne (g, ml, łyżki, łyżeczki, °C, cm; amount jako liczba lub null dla "do smaku").
3. Zero blogowych dygresji i marketingu — zostaw wyłącznie czystą esencję kulinarną.
4. Kategoria (dokładnie jedna z 6): Śniadania, Zupy, Dania główne, Sałatki i przekąski, Desery i wypieki, Napoje i dodatki.
5. Poziom trudności: Łatwy, Średni lub Wymagający.
6. Kroki numerowane kolejno od 1, ze zwięzłym tytułem i instrukcją.
7. Zdjęcia i wideo: wybieraj wyłącznie z dostarczonych kandydatów (dokładnie jedno zdjęcie z isMain=true), nie wymyślaj URL-i."""

GROQ_RECIPE_EXAMPLE_JSON = """{
  "id": "slug-przepisu",
  "slug": "slug-przepisu",
  "title": "Tytuł przepisu po polsku",
  "summary": "Apetyczne, zwięzłe podsumowanie przepisu (1-2 zdania po polsku).",
  "category": "Dania główne",
  "tags": ["danie główne", "obiad"],
  "prepTimeMinutes": 15,
  "cookTimeMinutes": 25,
  "totalTimeMinutes": 40,
  "servings": 4,
  "difficulty": "Łatwy",
  "images": [
    {
      "url": "https://domena.pl/zdjecie.jpg",
      "caption": "Gotowe danie na talerzu",
      "isMain": true
    }
  ],
  "videos": [],
  "ingredientGroups": [
    {
      "groupName": "Składniki",
      "items": [
        {
          "name": "Mąka pszenna",
          "amount": 500,
          "unit": "g",
          "notes": "przesiana"
        }
      ]
    }
  ],
  "steps": [
    {
      "stepNumber": 1,
      "title": "Przygotowanie ciasta",
      "instruction": "Połącz mąkę z wodą i wyrób jednolite, elastyczne ciasto.",
      "tip": "Odstaw ciasto pod przykryciem na 15 minut.",
      "imageUrl": null
    }
  ],
  "chefTips": [
    "Dla lepszego smaku dodaj szczyptę świeżo mielonego pieprzu."
  ],
  "sourceUrl": "https://domena.pl/przepis",
  "sourceDomain": "domena.pl",
  "originalLanguage": "pl",
  "createdAt": "2026-11-12T18:00:00.000Z"
}"""


def _build_groq_system_instruction() -> str:
    """Build a compact system instruction with an example JSON structure for Groq JSON mode."""
    current_utc = (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )
    return (
        f"{GROQ_SYSTEM_INSTRUCTION}\n\n"
        "WYMAGANY FORMAT WYJŚCIOWY (JSON):\n"
        "Zwróć WYŁĄCZNIE jeden poprawny obiekt JSON ściśle zgodny ze strukturą poniższego wzorca "
        "(bez bloków markdown ```json, bez komentarzy i bez dodatkowego tekstu poza JSON-em).\n"
        "Pola `sourceUrl` i `sourceDomain` przepisz dokładnie z danych wejściowych, "
        f"`id` ustaw tak samo jak `slug`, a w `createdAt` wpisz datę ISO 8601 (np. \"{current_utc}\").\n"
        f"Wzorcowa struktura JSON (RecipeSchema):\n{GROQ_RECIPE_EXAMPLE_JSON}"
    )


def _groq_model_rank(model_id: str) -> int:
    lowered = model_id.lower()
    for idx, keyword in enumerate(GROQ_MODEL_PRIORITY_KEYWORDS):
        if keyword in lowered:
            return idx
    return len(GROQ_MODEL_PRIORITY_KEYWORDS)


def _get_groq_active_models(client: Groq) -> list[str]:
    """Fetch active text/JSON models from Groq API, filter non-text models, and sort by quality."""
    models_resp = client.models.list()
    raw_models = getattr(models_resp, "data", None)
    if raw_models is None:
        try:
            raw_models = list(models_resp)
        except TypeError:
            raw_models = []

    candidates: list[str] = []
    seen: set[str] = set()
    for item in raw_models:
        is_active = (
            item.get("active", True)
            if isinstance(item, dict)
            else getattr(item, "active", True)
        )
        if is_active is False:
            continue

        raw_id = item.get("id") if isinstance(item, dict) else getattr(item, "id", None)
        model_id = str(raw_id or "").strip()
        if not model_id or model_id in seen:
            continue

        lowered = model_id.lower()
        if any(excluded in lowered for excluded in GROQ_EXCLUDED_MODEL_SUBSTRINGS):
            continue

        seen.add(model_id)
        candidates.append(model_id)

    return sorted(candidates, key=_groq_model_rank)


def call_openrouter_with_fallback(openrouter_key: str, prompt: str) -> dict[str, Any]:
    """Tier 2: Call OpenRouter Free cascade with OpenAI-compatible client and JSON mode."""
    client = OpenAI(
        api_key=openrouter_key,
        base_url="https://openrouter.ai/api/v1",
        default_headers={
            "HTTP-Referer": "https://github.com/phxphoenix/Ulubione-przepisy-Kasi",
            "X-Title": "Ulubione przepisy Kasi",
        },
    )
    effective_prompt = _prepare_openrouter_prompt(prompt)
    system_instruction = _build_openrouter_system_instruction()
    last_error: Optional[Exception] = None

    for model_name in OPENROUTER_FREE_MODELS:
        try:
            print(
                f"[AI Agent] [Poziom 2: OpenRouter Free] Używam modelu: {model_name}",
                flush=True,
            )
            response = client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": effective_prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0.2,
                timeout=REQUEST_TIMEOUT_OPENROUTER,
            )

            raw_content = response.choices[0].message.content if response.choices else None
            if not raw_content or not raw_content.strip():
                raise ValueError(f"Model OpenRouter ({model_name}) zwrócił pustą odpowiedź.")

            cleaned_json = _extract_json_block(raw_content)
            validated_recipe = RecipeSchema.model_validate_json(cleaned_json)
            print(
                f"[AI Agent] [Poziom 2: OpenRouter Free] Przepis wygenerowany przez: {model_name}",
                flush=True,
            )
            return validated_recipe.model_dump()

        except (openai.AuthenticationError, openai.PermissionDeniedError) as exc:
            last_error = exc
            print(
                f"[AI Agent] [Poziom 2: OpenRouter Free] Błąd autoryzacji ({model_name}): {exc}",
                flush=True,
            )
            break
        except (openai.RateLimitError, openai.APITimeoutError, TimeoutError) as exc:
            last_error = exc
            print(
                f"[AI Agent] [Poziom 2: OpenRouter Free] Limit lub timeout ({model_name}): {exc}. "
                "Przełączam na kolejny model...",
                flush=True,
            )
            continue
        except openai.APIStatusError as exc:
            last_error = exc
            status_code = getattr(exc, "status_code", None)
            if status_code == 401:
                print(
                    f"[AI Agent] [Poziom 2: OpenRouter Free] Błąd autoryzacji HTTP 401: {exc}",
                    flush=True,
                )
                break
            print(
                f"[AI Agent] [Poziom 2: OpenRouter Free] Błąd HTTP {status_code} dla {model_name}: {exc}. "
                "Przełączam na kolejny model...",
                flush=True,
            )
            continue
        except (
            openai.APIConnectionError,
            openai.APIError,
            ValidationError,
            json.JSONDecodeError,
            ValueError,
        ) as exc:
            last_error = exc
            print(
                f"[AI Agent] [Poziom 2: OpenRouter Free] Błąd dla {model_name}: {exc}. "
                "Przełączam na kolejny model...",
                flush=True,
            )
            continue
        except Exception as exc:
            last_error = exc
            print(
                f"[AI Agent] [Poziom 2: OpenRouter Free] Nieoczekiwany błąd dla {model_name}: {exc}. "
                "Przełączam na kolejny model...",
                flush=True,
            )
            continue

    raise RuntimeError(
        f"Wszystkie modele OpenRouter Free ({', '.join(OPENROUTER_FREE_MODELS)}) zawiodły. "
        f"Ostatni błąd: {last_error}"
    )


def call_groq_with_fallback(groq_key: str, prompt: str) -> dict[str, Any]:
    """Tier 3: Call Groq Cloud using dynamically discovered active text models with compact payload."""
    client = Groq(api_key=groq_key)
    models_to_try = _get_groq_active_models(client)
    if not models_to_try:
        raise RuntimeError(
            "Brak aktywnych modeli tekstowych Groq dostępnych dla podanego klucza API."
        )

    print(
        f"[AI Agent] [Poziom 3: Groq Cloud] Aktywne modele tekstowe ({len(models_to_try)}): "
        f"{', '.join(models_to_try)}",
        flush=True,
    )

    effective_prompt = _prepare_groq_prompt(prompt)
    system_instruction = _build_groq_system_instruction()
    last_error: Optional[Exception] = None

    for model_name in models_to_try:
        try:
            print(
                f"[AI Agent] [Poziom 3: Groq Cloud] Używam modelu: {model_name}",
                flush=True,
            )
            response = client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": effective_prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0.2,
                timeout=REQUEST_TIMEOUT_GROQ,
            )

            raw_content = response.choices[0].message.content if response.choices else None
            if not raw_content or not raw_content.strip():
                raise ValueError(f"Model Groq ({model_name}) zwrócił pustą odpowiedź.")

            cleaned_json = _extract_json_block(raw_content)
            validated_recipe = RecipeSchema.model_validate_json(cleaned_json)
            print(
                f"[AI Agent] [Poziom 3: Groq Cloud] Przepis wygenerowany przez: {model_name}",
                flush=True,
            )
            return validated_recipe.model_dump()

        except (groq.AuthenticationError, groq.PermissionDeniedError) as exc:
            last_error = exc
            print(
                f"[AI Agent] [Poziom 3: Groq Cloud] Błąd autoryzacji ({model_name}): {exc}",
                flush=True,
            )
            break
        except (groq.RateLimitError, groq.APITimeoutError, TimeoutError) as exc:
            last_error = exc
            print(
                f"[AI Agent] [Poziom 3: Groq Cloud] Limit lub timeout ({model_name}): {exc}. "
                "Przełączam na kolejny model...",
                flush=True,
            )
            continue
        except groq.APIStatusError as exc:
            last_error = exc
            status_code = getattr(exc, "status_code", None)
            if status_code in {400, 404, 429}:
                print(
                    f"[AI Agent] [Poziom 3: Groq Cloud] Błąd HTTP {status_code} dla {model_name}: {exc}. "
                    "Przełączam na kolejny model...",
                    flush=True,
                )
                continue
            if status_code == 401:
                print(
                    f"[AI Agent] [Poziom 3: Groq Cloud] Błąd autoryzacji HTTP 401: {exc}",
                    flush=True,
                )
                break
            print(
                f"[AI Agent] [Poziom 3: Groq Cloud] Błąd API HTTP {status_code} dla {model_name}: {exc}. "
                "Przełączam na kolejny model...",
                flush=True,
            )
            continue
        except (
            groq.APIConnectionError,
            groq.APIError,
            ValidationError,
            json.JSONDecodeError,
            ValueError,
        ) as exc:
            last_error = exc
            print(
                f"[AI Agent] [Poziom 3: Groq Cloud] Błąd dla {model_name}: {exc}. "
                "Przełączam na kolejny model...",
                flush=True,
            )
            continue
        except Exception as exc:
            last_error = exc
            print(
                f"[AI Agent] [Poziom 3: Groq Cloud] Nieoczekiwany błąd dla {model_name}: {exc}. "
                "Przełączam na kolejny model...",
                flush=True,
            )
            continue

    raise RuntimeError(
        f"Wszystkie modele Groq ({', '.join(models_to_try)}) zawiodły. "
        f"Ostatni błąd: {last_error}"
    )


def resolve_gemini_models(raw_models: Optional[str] = None) -> list[str]:
    """Resolve Gemini model cascade from GEMINI_MODELS env var or default list."""
    raw = raw_models if raw_models is not None else os.environ.get("GEMINI_MODELS", "")
    source = raw.strip() or DEFAULT_GEMINI_MODELS
    models = [item.strip() for item in source.split(",") if item.strip()]
    if not models:
        models = list(GEMINI_MODEL_CASCADE)
    return list(dict.fromkeys(models))


def _create_gemini_client(gemini_key: str) -> tuple[genai.Client, str]:
    """Always initialize Gemini Developer API client without vertexai=True (free endpoint)."""
    return genai.Client(api_key=gemini_key), "Google Gemini"


def _is_gemini_auth_error(exc: errors.APIError) -> bool:
    code = getattr(exc, "code", None)
    status = str(getattr(exc, "status", "") or "").upper()
    msg = str(exc).upper()
    return (
        code == 401
        or "UNAUTHENTICATED" in status
        or "API_KEY_INVALID" in msg
        or "API KEY NOT VALID" in msg
        or "INVALID API KEY" in msg
    )


def _is_gemini_exhausted_or_not_found(exc: errors.APIError) -> bool:
    """Return True for 403/404/429 model permission, not-found, or quota errors."""
    code = getattr(exc, "code", None)
    status = str(getattr(exc, "status", "") or "").upper()
    msg = str(exc).upper()
    if code in {403, 404, 429}:
        return True
    if any(tok in status for tok in ("RESOURCE_EXHAUSTED", "NOT_FOUND", "PERMISSION_DENIED")):
        return True
    if "RESOURCE_EXHAUSTED" in msg:
        return True
    if code == 400 and any(
        tok in msg for tok in ("NOT FOUND", "NOT SUPPORTED", "DEPRECATED", "UNKNOWN MODEL")
    ):
        return True
    return False


def _is_gemini_transient_503(exc: errors.APIError) -> bool:
    code = getattr(exc, "code", None)
    status = str(getattr(exc, "status", "") or "").upper()
    msg = str(exc).upper()
    return (
        code in {500, 502, 503, 504}
        or "UNAVAILABLE" in status
        or "503" in msg
    )


def _get_gemini_throttle_delay(model_name: str) -> float:
    """Throttling Guard: 4.5s for 'lite' models, 12.5s for full 'flash' models."""
    if "lite" in model_name.lower():
        return GEMINI_LITE_THROTTLE_SECONDS
    return GEMINI_FLASH_THROTTLE_SECONDS


def _transport_exception_types() -> tuple[type[BaseException], ...]:
    types_list: list[type[BaseException]] = [requests.RequestException, OSError, TimeoutError]
    if httpx is not None:
        types_list.append(httpx.HTTPError)
    return tuple(types_list)


def call_gemini_with_fallback(
    gemini_key: str,
    prompt: str,
    *,
    gemini_models: Optional[Sequence[str]] = None,
    exhausted_models: Optional[set[str]] = None,
) -> dict[str, Any]:
    """Tier 1: Free Google Gemini Developer API cascade with exhausted-model memory & Throttling Guard."""
    models_to_try = (
        list(dict.fromkeys(m.strip() for m in gemini_models if m.strip()))
        if gemini_models is not None
        else resolve_gemini_models()
    )
    if not models_to_try:
        models_to_try = list(GEMINI_MODEL_CASCADE)

    exhausted = exhausted_models if exhausted_models is not None else set()
    client, provider_label = _create_gemini_client(gemini_key)
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_INSTRUCTION,
        response_mime_type="application/json",
        response_schema=RecipeSchema,
    )
    transport_errors = _transport_exception_types()
    last_error: Optional[Exception] = None
    max_attempts_per_model = 2

    for model_idx, model_name in enumerate(models_to_try):
        if model_name in exhausted:
            print(
                f"[AI Agent] [Poziom 1: {provider_label}] Pomijam model {model_name} (w exhausted_models).",
                flush=True,
            )
            continue

        has_next_model = model_idx + 1 < len(models_to_try)

        for attempt in range(max_attempts_per_model):
            try:
                print(
                    f"[AI Agent] [Poziom 1: {provider_label}] Używam modelu: {model_name} "
                    f"(próba {attempt + 1}/{max_attempts_per_model})",
                    flush=True,
                )
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=config,
                )

                if isinstance(response.parsed, RecipeSchema):
                    print(
                        f"[AI Agent] [Poziom 1: {provider_label}] Przepis wygenerowany przez: {model_name}",
                        flush=True,
                    )
                    return response.parsed.model_dump()

                raw_text = response.text
                if raw_text and raw_text.strip():
                    validated_recipe = RecipeSchema.model_validate_json(
                        _strip_code_fences(raw_text)
                    )
                    print(
                        f"[AI Agent] [Poziom 1: {provider_label}] Przepis wygenerowany przez: {model_name}",
                        flush=True,
                    )
                    return validated_recipe.model_dump()

                raise ValueError(f"Model {model_name} zwrócił pustą odpowiedź.")

            except errors.APIError as exc:
                last_error = exc
                code = getattr(exc, "code", None)
                if code in {403, 404, 429} or _is_gemini_exhausted_or_not_found(exc):
                    exhausted.add(model_name)
                    print(
                        f"[AI Agent] [Poziom 1: {provider_label}] Model {model_name} zwrócił błąd {code}: {exc}. "
                        "Przechodzę na kolejny model z listy...",
                        flush=True,
                    )
                    break
                if _is_gemini_auth_error(exc):
                    print(
                        f"[AI Agent] [Poziom 1: {provider_label}] Błąd autoryzacji ({code}): {exc}",
                        flush=True,
                    )
                    raise
                if _is_gemini_transient_503(exc):
                    delay = _get_gemini_throttle_delay(model_name)
                    if attempt + 1 < max_attempts_per_model:
                        print(
                            f"[AI Agent] [Poziom 1: {provider_label}] Przeciążenie/błąd {code} dla {model_name}. "
                            f"Throttling Guard: czekam {delay:.1f}s przed ponowieniem...",
                            flush=True,
                        )
                        time.sleep(delay)
                        continue
                    if has_next_model:
                        print(
                            f"[AI Agent] [Poziom 1: {provider_label}] Utrzymujący się błąd {code} dla {model_name}. "
                            f"Throttling Guard: czekam {delay:.1f}s przed przełączeniem na kolejny model...",
                            flush=True,
                        )
                        time.sleep(delay)
                    break
                raise
            except (*transport_errors, ValidationError, json.JSONDecodeError, ValueError) as exc:
                last_error = exc
                delay = _get_gemini_throttle_delay(model_name)
                if attempt + 1 < max_attempts_per_model:
                    print(
                        f"[AI Agent] [Poziom 1: {provider_label}] Błąd sieci/odpowiedzi dla {model_name}: {exc}. "
                        f"Throttling Guard: czekam {delay:.1f}s przed ponowieniem...",
                        flush=True,
                    )
                    time.sleep(delay)
                    continue
                if has_next_model:
                    print(
                        f"[AI Agent] [Poziom 1: {provider_label}] Błąd sieci/odpowiedzi dla {model_name}: {exc}. "
                        f"Throttling Guard: czekam {delay:.1f}s przed przełączeniem na kolejny model...",
                        flush=True,
                    )
                    time.sleep(delay)
                break

    raise RuntimeError(
        f"Wszystkie modele w kaskadzie Gemini ({', '.join(models_to_try)}) zawiodły. "
        f"Ostatni błąd: {last_error}"
    )


def call_ai_with_fallback(
    prompt: str,
    *,
    gemini_api_key: str = "",
    openrouter_api_key: str = "",
    groq_api_key: str = "",
    openrouter_prompt: Optional[str] = None,
    groq_prompt: Optional[str] = None,
    gemini_models: Optional[Sequence[str]] = None,
    exhausted_models: Optional[set[str]] = None,
) -> dict[str, Any]:
    """Run 3-tier 100% free AI cascade router:
    Poziom 1: Google Gemini Developer API (GEMINI_API_KEY)
    Poziom 2: OpenRouter Free (OPENROUTER_API_KEY)
    Poziom 3: Groq Cloud (GROQ_API_KEY)
    """
    gemini_key = gemini_api_key.strip()
    openrouter_key = openrouter_api_key.strip()
    groq_key = groq_api_key.strip()

    if not gemini_key and not openrouter_key and not groq_key:
        raise RuntimeError(
            "Brak skonfigurowanych kluczy API (GEMINI_API_KEY, OPENROUTER_API_KEY ani GROQ_API_KEY)."
        )

    errors_by_tier: list[str] = []

    # POZIOM 1: Google Gemini Developer API (główny priorytet)
    if gemini_key:
        try:
            print("[AI Agent] Uruchamiam Poziom 1: Google Gemini Developer API...", flush=True)
            return call_gemini_with_fallback(
                gemini_key,
                prompt,
                gemini_models=gemini_models,
                exhausted_models=exhausted_models,
            )
        except Exception as exc:
            errors_by_tier.append(f"Google Gemini (Poziom 1): {exc}")
            print(
                f"[AI Agent] Poziom 1 (Google Gemini Developer API) zawiódł ({exc}). "
                "Przechodzę do kolejnego poziomu...",
                flush=True,
            )
    else:
        print(
            "[AI Agent] Brak GEMINI_API_KEY — pomijam Poziom 1 (Google Gemini Developer API)...",
            flush=True,
        )

    # POZIOM 2: OpenRouter Free (Fallback 1)
    if openrouter_key:
        effective_openrouter_prompt = (
            openrouter_prompt if openrouter_prompt is not None else prompt
        )
        try:
            print("[AI Agent] Uruchamiam Poziom 2: OpenRouter Free...", flush=True)
            return call_openrouter_with_fallback(openrouter_key, effective_openrouter_prompt)
        except Exception as exc:
            errors_by_tier.append(f"OpenRouter Free (Poziom 2): {exc}")
            print(
                f"[AI Agent] Poziom 2 (OpenRouter Free) zawiódł ({exc}). "
                "Przechodzę do kolejnego poziomu...",
                flush=True,
            )
    else:
        print(
            "[AI Agent] Brak OPENROUTER_API_KEY — pomijam Poziom 2 (OpenRouter Free)...",
            flush=True,
        )

    # POZIOM 3: Groq Cloud (Fallback 2)
    if groq_key:
        effective_groq_prompt = (
            groq_prompt if groq_prompt is not None else prompt
        )
        try:
            print("[AI Agent] Uruchamiam Poziom 3: Groq Cloud...", flush=True)
            return call_groq_with_fallback(groq_key, effective_groq_prompt)
        except Exception as exc:
            errors_by_tier.append(f"Groq Cloud (Poziom 3): {exc}")
            print(
                f"[AI Agent] Poziom 3 (Groq Cloud) zawiódł ({exc}).",
                flush=True,
            )
    else:
        print(
            "[AI Agent] Brak GROQ_API_KEY — pomijam Poziom 3 (Groq Cloud)...",
            flush=True,
        )

    raise RuntimeError(
        "Wszystkie aktywne poziomy kaskady AI zawiodły. Błędy: "
        + " | ".join(errors_by_tier)
    )


def generate_unique_slug(title: str, recipes_dir: Path) -> str:
    """Create a unique, readable slug from the Polish recipe title."""
    base_slug = slugify(title, lowercase=True, max_length=90, word_boundary=True) or "przepis"

    existing_slugs: set[str] = set()
    if recipes_dir.exists():
        for json_file in recipes_dir.glob("*.json"):
            existing_slugs.add(json_file.stem)
            try:
                content = json.loads(json_file.read_text(encoding="utf-8"))
                if isinstance(content, dict) and isinstance(content.get("slug"), str):
                    existing_slugs.add(content["slug"].strip())
            except (OSError, json.JSONDecodeError):
                pass

    if base_slug not in existing_slugs:
        return base_slug

    counter = 2
    while f"{base_slug}-{counter}" in existing_slugs:
        counter += 1
    return f"{base_slug}-{counter}"


def _sanitize_images(
    raw_images: Any, extracted_candidates: Sequence[ImageCandidate]
) -> list[dict[str, Any]]:
    allowed_urls = {cand.url for cand in extracted_candidates}
    cleaned: list[dict[str, Any]] = []
    seen_urls: set[str] = set()

    if isinstance(raw_images, list):
        for item in raw_images:
            if not isinstance(item, dict):
                continue
            raw_url = _strip_or_none(item.get("url"))
            if not raw_url:
                continue
            parsed = urlparse(raw_url)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                continue
            if allowed_urls and raw_url not in allowed_urls:
                continue
            if raw_url in seen_urls:
                continue
            seen_urls.add(raw_url)
            entry: dict[str, Any] = {
                "url": raw_url,
                "isMain": bool(item.get("isMain")),
            }
            caption = _strip_or_none(item.get("caption"))
            if caption:
                entry["caption"] = caption
            cleaned.append(entry)

    if not cleaned and extracted_candidates:
        for idx, cand in enumerate(extracted_candidates[:4]):
            entry = {"url": cand.url, "isMain": idx == 0}
            if cand.alt:
                entry["caption"] = cand.alt
            cleaned.append(entry)

    if not cleaned:
        raise ValueError("Brak prawidłowych zdjęć potrawy — schemat Astro wymaga co najmniej 1 zdjęcia.")

    main_index = next((i for i, img in enumerate(cleaned) if img.get("isMain")), 0)
    for idx, img in enumerate(cleaned):
        img["isMain"] = idx == main_index

    if main_index > 0:
        main_img = cleaned.pop(main_index)
        cleaned.insert(0, main_img)

    return cleaned


def _sanitize_videos(
    raw_videos: Any, extracted_videos: Sequence[VideoCandidate], base_url: str
) -> list[dict[str, Any]]:
    extracted_by_embed = {(v.platform, v.embed_url): v for v in extracted_videos}
    sanitized: list[dict[str, Any]] = []
    seen_keys: set[tuple[str, str]] = set()

    if isinstance(raw_videos, list):
        for item in raw_videos:
            if not isinstance(item, dict):
                continue
            raw_url = _strip_or_none(item.get("url")) or _strip_or_none(item.get("embedUrl"))
            if not raw_url:
                continue
            normalized = normalize_video_url(
                raw_url,
                base_url,
                title=_strip_or_none(item.get("title")),
            )
            if normalized is None:
                embed_candidate = _strip_or_none(item.get("embedUrl"))
                if embed_candidate:
                    normalized = normalize_video_url(
                        embed_candidate,
                        base_url,
                        title=_strip_or_none(item.get("title")),
                    )
            if normalized is None:
                continue

            key = (normalized.platform, normalized.embed_url)
            if extracted_by_embed and key not in extracted_by_embed:
                continue
            if key in seen_keys:
                continue
            seen_keys.add(key)

            matched = extracted_by_embed.get(key)
            entry: dict[str, Any] = {
                "url": matched.url if matched else normalized.url,
                "platform": normalized.platform,
                "embedUrl": normalized.embed_url,
            }
            title = normalized.title or (matched.title if matched else None)
            if title:
                entry["title"] = title
            sanitized.append(entry)

    if not sanitized:
        for cand in extracted_videos:
            if cand.source == "jsonld_recipe":
                key = (cand.platform, cand.embed_url)
                if key not in seen_keys:
                    seen_keys.add(key)
                    entry = {
                        "url": cand.url,
                        "platform": cand.platform,
                        "embedUrl": cand.embed_url,
                    }
                    if cand.title:
                        entry["title"] = cand.title
                    sanitized.append(entry)

    return sanitized


def _sanitize_steps(
    raw_steps: Any, valid_image_urls: set[str]
) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    if not isinstance(raw_steps, list):
        return cleaned

    for item in raw_steps:
        if not isinstance(item, dict):
            continue
        instruction = _strip_or_none(item.get("instruction"))
        if not instruction:
            continue
        step: dict[str, Any] = {
            "stepNumber": len(cleaned) + 1,
            "instruction": instruction,
        }
        title = _strip_or_none(item.get("title"))
        if title:
            step["title"] = title
        tip = _strip_or_none(item.get("tip"))
        if tip:
            step["tip"] = tip
        img_url = _strip_or_none(item.get("imageUrl"))
        if img_url and (not valid_image_urls or img_url in valid_image_urls):
            step["imageUrl"] = img_url
        cleaned.append(step)

    return cleaned


def _sanitize_ingredient_groups(raw_groups: Any) -> list[dict[str, Any]]:
    cleaned_groups: list[dict[str, Any]] = []
    if not isinstance(raw_groups, list):
        return cleaned_groups

    for group in raw_groups:
        if not isinstance(group, dict):
            continue
        raw_items = group.get("items")
        if not isinstance(raw_items, list):
            continue
        cleaned_items: list[dict[str, Any]] = []
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            name = _strip_or_none(item.get("name"))
            if not name:
                continue
            entry: dict[str, Any] = {"name": name}
            amount = item.get("amount")
            if isinstance(amount, (int, float)) and not isinstance(amount, bool):
                if amount >= 0:
                    entry["amount"] = round(float(amount), 2) if isinstance(amount, float) else amount
            unit = _strip_or_none(item.get("unit"))
            if unit:
                entry["unit"] = unit
            notes = _strip_or_none(item.get("notes"))
            if notes:
                entry["notes"] = notes
            cleaned_items.append(entry)

        if cleaned_items:
            group_entry: dict[str, Any] = {"items": cleaned_items}
            group_name = _strip_or_none(group.get("groupName"))
            if group_name:
                group_entry["groupName"] = group_name
            cleaned_groups.append(group_entry)

    return cleaned_groups


def finalize_recipe(
    raw_recipe: dict[str, Any],
    extracted: ExtractedPageData,
    recipes_dir: Path,
) -> Recipe:
    """Normalize, ground media URLs, assign deterministic metadata, and validate against Recipe schema."""
    title = _strip_or_none(raw_recipe.get("title")) or "Przepis kulinarny"
    slug = generate_unique_slug(title, recipes_dir)

    prep_time = raw_recipe.get("prepTimeMinutes")
    prep_clean = int(prep_time) if isinstance(prep_time, (int, float)) and prep_time >= 0 else None

    cook_time = raw_recipe.get("cookTimeMinutes")
    cook_clean = int(cook_time) if isinstance(cook_time, (int, float)) and cook_time >= 0 else None

    total_time = raw_recipe.get("totalTimeMinutes")
    if isinstance(total_time, (int, float)) and int(total_time) >= 1:
        total_clean = int(total_time)
    else:
        summed = (prep_clean or 0) + (cook_clean or 0)
        total_clean = summed if summed >= 1 else 15

    servings_raw = raw_recipe.get("servings")
    servings_clean = (
        float(servings_raw)
        if isinstance(servings_raw, (int, float)) and not isinstance(servings_raw, bool) and servings_raw > 0
        else 4.0
    )
    if servings_clean.is_integer():
        servings_clean = int(servings_clean)

    images = _sanitize_images(raw_recipe.get("images"), extracted.image_candidates)
    allowed_img_urls = {cand.url for cand in extracted.image_candidates} | {
        img["url"] for img in images
    }
    steps = _sanitize_steps(raw_recipe.get("steps"), allowed_img_urls)
    videos = _sanitize_videos(
        raw_recipe.get("videos"), extracted.video_candidates, extracted.final_url
    )
    ingredient_groups = _sanitize_ingredient_groups(raw_recipe.get("ingredientGroups"))

    category = raw_recipe.get("category")
    if category not in ALLOWED_CATEGORIES:
        category = "Dania główne"

    difficulty = raw_recipe.get("difficulty")
    if difficulty not in ALLOWED_DIFFICULTIES:
        difficulty = "Średni"

    orig_lang = _strip_or_none(raw_recipe.get("originalLanguage")) or (
        extracted.language_hint.split("-")[0].lower() if extracted.language_hint else "en"
    )
    if len(orig_lang) < 2:
        orig_lang = "en"

    created_at = (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )

    payload: dict[str, Any] = {
        "id": slug,
        "slug": slug,
        "title": title,
        "summary": _strip_or_none(raw_recipe.get("summary")) or title,
        "category": category,
        "tags": raw_recipe.get("tags") if isinstance(raw_recipe.get("tags"), list) else [],
        "prepTimeMinutes": prep_clean,
        "cookTimeMinutes": cook_clean,
        "totalTimeMinutes": total_clean,
        "servings": servings_clean,
        "difficulty": difficulty,
        "images": images,
        "videos": videos,
        "ingredientGroups": ingredient_groups,
        "steps": steps,
        "chefTips": raw_recipe.get("chefTips") if isinstance(raw_recipe.get("chefTips"), list) else [],
        "sourceUrl": extracted.source_url,
        "sourceDomain": extract_source_domain(extracted.source_url),
        "originalLanguage": orig_lang,
        "createdAt": created_at,
    }

    return Recipe.model_validate(payload)


def save_recipe_and_emit_outputs(recipe: Recipe, recipes_dir: Path) -> Path:
    recipes_dir.mkdir(parents=True, exist_ok=True)
    output_file = recipes_dir / f"{recipe.slug}.json"
    serialized = json.dumps(
        recipe.model_dump(exclude_none=True),
        indent=2,
        ensure_ascii=False,
    )
    output_file.write_text(serialized + "\n", encoding="utf-8")

    rel_path = f"src/content/recipes/{recipe.slug}.json"
    print(f"recipe_slug={recipe.slug}")
    print(f"recipe_path={rel_path}")

    github_output = os.environ.get("GITHUB_OUTPUT", "").strip()
    if github_output:
        with open(github_output, "a", encoding="utf-8") as handle:
            handle.write(f"recipe_slug={recipe.slug}\n")
            handle.write(f"recipe_path={rel_path}\n")

    return output_file


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generuje przetłumaczony i ustrukturyzowany przepis JSON dla 'Ulubione przepisy Kasi'."
    )
    parser.add_argument(
        "--url",
        default=os.environ.get("RECIPE_URL"),
        required=False,
        help="Adres URL strony źródłowej z przepisem.",
    )
    args = parser.parse_args(argv)
    if not args.url or not str(args.url).strip():
        parser.error("Parametr --url (lub zmienna środowiskowa RECIPE_URL) jest wymagany.")
    args.url = str(args.url).strip()
    return args


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)

    try:
        url = validate_input_url(args.url)
    except ValueError as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1

    gemini_api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    openrouter_api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    groq_api_key = os.environ.get("GROQ_API_KEY", "").strip()
    if not gemini_api_key and not openrouter_api_key and not groq_api_key:
        print(
            "[ERROR] Brak skonfigurowanych zmiennych środowiskowych z kluczami API: "
            "GEMINI_API_KEY, OPENROUTER_API_KEY ani GROQ_API_KEY.",
            file=sys.stderr,
        )
        return 1

    try:
        extracted = collect_page_data(url)
        full_prompt = build_prompt(extracted, max_text_chars=FULL_PROMPT_TEXT_CHARS)
        openrouter_prompt = build_prompt(extracted, max_text_chars=OPENROUTER_PROMPT_TEXT_CHARS)
        groq_prompt = build_groq_prompt(extracted)
        raw_recipe = call_ai_with_fallback(
            full_prompt,
            gemini_api_key=gemini_api_key,
            openrouter_api_key=openrouter_api_key,
            groq_api_key=groq_api_key,
            openrouter_prompt=openrouter_prompt,
            groq_prompt=groq_prompt,
        )
        recipe = finalize_recipe(raw_recipe, extracted, RECIPES_DIR)
        saved_path = save_recipe_and_emit_outputs(recipe, RECIPES_DIR)
        log_info(f"Zapisano przepis: {saved_path}")
        return 0
    except Exception as exc:
        print(f"[ERROR] Nie udało się wygenerować przepisu: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
