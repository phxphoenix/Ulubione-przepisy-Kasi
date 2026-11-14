# Agent AI i automatyzacja przepisów

Za przetwarzanie przepisów w repozytorium odpowiadają dwa skrypty Pythona w katalogu `scripts/`, uruchamiane przez GitHub Actions.

---

## 1. Dodawanie przepisu (`scripts/generate_recipe.py`)

Skrypt wywoływany jest przez workflow `.github/workflows/add-recipe.yml` poleceniem:

```bash
python scripts/generate_recipe.py --url "<ADRES_URL>"
```

### Etap A i B: Dwutorowe pobieranie treści (`collect_page_data`)

1. **Krok A — bezpośredni scraping HTML (`extract_from_html`):**
   - Pobiera dokument HTML przy użyciu nagłówków przeglądarkowych (`BROWSER_HEADERS`) lub, w przypadku domen `facebook.com` / `fb.com` / `fb.watch`, nagłówka `facebookexternalhit/1.1` (`FACEBOOK_CRAWLER_HEADERS`), aby odzyskać metadane OpenGraph (`og:title`, `og:description`, `og:image`).
   - Wykrywa strony blokad antybotowych (Cloudflare *„Just a moment...”*, 403, *„verify you are human”*) poprzez `_is_challenge_or_error_text`.
2. **Krok B-HTML i B — `r.jina.ai`:**
   - Jeśli Krok A zawiódł, zwrócił blokadę albo nie dostarczył danych JSON-LD i wystarczającej ilości tekstu (< 250 znaków), skrypt pobiera wyrenderowany HTML przez `r.jina.ai` (`X-Return-Format: html`), a następnie czysty Markdown przez `https://r.jina.ai/<url>` (z krótkim mechanizmem ponowień dla błędów 429/5xx).
3. **Parsowanie strukturalne (`parse_html_document`):**
   - Wydobywa obiekty `Schema.org Recipe` i `VideoObject` z bloków `application/ld+json`, rozwiązując referencje `@id` wewnątrz `@graph`.
   - Wyciąga tekst główny z kontenerów artykułu (`article`, `main`, `.wprm-recipe-container`, `.tasty-recipes` itp.), usuwając elementy nawigacji, stopki, komentarze i banery reklamowe.
   - Normalizuje linki wideo (`normalize_video_url`) dla platform YouTube (w tym Shorts), Instagram (`p`, `reel`, `tv`), TikTok oraz bezpośrednich plików `.mp4`.

### Warstwa 0, 1 i 2: Obsługa i weryfikacja zdjęć

Agent nigdy nie zmyśla adresów URL grafik. Proces wyboru zdjęcia składa się z trzech warstw:

1. **Warstwa 0 — filtracja kandydatów (`is_valid_image_candidate`, `_verify_image_candidates`):**
   - Odrzuca pliki `.svg`, `.ico`, elementy UI mediów społecznościowych (np. `static.xx.fbcdn.net/rsrc.php`, `facebook.com/images/`, `hads-*`), awatary, ikony, logotypy i miniatury poniżej `200×200` px.
   - Wstępnie pobiera nagłówek pliku (do 64 KB) poprzez `_probe_image_url`, odczytując wymiary bez zewnętrznych zależności z nagłówków PNG, GIF, WebP oraz JPEG oraz odrzucając pliki poniżej `5000` bajtów.
2. **Warstwa 1 — utrwalanie nietrwałych CDN (`_persist_ephemeral_images`):**
   - Adresy z domen wygasających lub podpisanych czasowo (`fbcdn.net`, `cdninstagram.com`, `tiktokcdn*.com` albo parametry `oe=` / `x-expires=`) są pobierane i zapisywane lokalnie w `public/images/recipes/<slug>-main.<ext>` (lub `-step-<n>.<ext>`), a odwołania w JSON i krokach są przepisywane na ścieżki lokalne.
3. **Warstwa 2 — wyszukiwanie zastępcze (`search_fallback_images`):**
   - Gdy źródło nie zawiera żadnego poprawnego zdjęcia (np. sam tekst w poście), prompt kieruje model LLM na wygenerowanie 3–4 zapytań w polu `imageSearchQueries` (po polsku i angielsku).
   - Skrypt przeszukuje bezkluczowe, publiczne API: **Wikipedia PageImages** (`pl` i `en`), **Wikimedia Commons**, a w razie braku wyników także **Openverse**, filtrując szum (np. mapy, ikony, halloweenowe dynie) i weryfikując rozmiar obrazu.

### 3-poziomowa kaskada AI (`call_ai_with_fallback`)

Każdy poziom przekształca zebrane dane do ścisłego schematu `RecipeSchema` (język polski, jednostki metryczne, brak dygresji blogowych):

| Poziom | Dostawca | Zmienna środowiskowa | Uwagi techniczne |
| --- | --- | --- | --- |
| **1 (priorytet)** | Google Gemini Developer API | `GEMINI_API_KEY` | Kaskada modeli z `GEMINI_MODELS` (domyślnie `gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.6-flash,gemini-3-flash,gemini-3.1-flash-lite`), pamięć wyczerpanych modeli, *Throttling Guard* (4.5s dla `lite`, 12.5s dla `flash`), natywny `response_schema` |
| **2 (fallback 1)** | OpenRouter Free | `OPENROUTER_API_KEY` | Modele darmowe (`openrouter/free`, `google/gemma-3-27b-it:free`, `meta-llama/llama-3.3-70b-instruct:free`, `mistralai/mistral-small-3.1-24b-instruct:free`), limit tekstu artykułu 20 000 znaków |
| **3 (fallback 2)** | Groq Cloud | `GROQ_API_KEY` | Dynamiczne odkrywanie aktywnych modeli tekstowych (`_get_groq_active_models`) z filtrowaniem modeli audio/vision/guard, kompaktowy prompt (pominięcie tekstu strony, jeśli istnieje JSON-LD, lub limit 6500 znaków) |

Po wygenerowaniu `finalize_recipe` przypisuje unikalny `slug` (`generate_unique_slug`), wymusza dokładnie jedno główne zdjęcie (`isMain: true` na indeksie 0), czyści kroki i grupy składników oraz zapisuje plik `src/content/recipes/<slug>.json`.

---

## 2. Usuwanie przepisu (`scripts/delete_recipe.py`)

Workflow `.github/workflows/delete-recipe.yml` uruchamia:

```bash
python scripts/delete_recipe.py --slug "<SLUG>"
```

Skrypt zapewnia następujące zabezpieczenia:

- **Walidacja sluga (`_is_safe_slug`)** — odrzuca puste wartości, `.` / `..`, ukośniki oraz białe znaki i znaki sterujące.
- **Dopasowanie pliku (`_find_matching_recipe_files`)** — szuka pliku `<slug>.json` oraz dopasowuje pola `slug` i `id` wewnątrz istniejących plików JSON.
- **Bezpieczne czyszczenie obrazów** — usuwa z `public/images/recipes/` wyłącznie te lokalne zdjęcia powiązane z usuwanym przepisem, które **nie są** używane przez żaden inny pozostały przepis (chroni także przed path traversal poza katalog `public/images/recipes/`).
- **Ochrona katalogu w Git** — jeżeli usunięto ostatni plik `.json`, tworzy pusty plik `.gitkeep`, aby loader Astro `glob` nie zgłaszał błędu brakującego katalogu.
