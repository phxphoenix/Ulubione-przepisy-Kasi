# Ulubione przepisy Kasi

[![Testy i weryfikacja CI](https://github.com/phxphoenix/Ulubione-przepisy-Kasi/actions/workflows/ci.yml/badge.svg)](https://github.com/phxphoenix/Ulubione-przepisy-Kasi/actions/workflows/ci.yml)
[![Wdrożenie na GitHub Pages](https://github.com/phxphoenix/Ulubione-przepisy-Kasi/actions/workflows/deploy.yml/badge.svg)](https://github.com/phxphoenix/Ulubione-przepisy-Kasi/actions/workflows/deploy.yml)

**Ulubione przepisy Kasi** to statyczna, bezserwerowa (Jamstack) aplikacja książki kucharskiej połączona z autonomicznym agentem AI działającym na GitHub Actions. Na podstawie wklejonego adresu URL ze strony kulinarnej lub mediów społecznościowych agent pobiera przepis, tłumaczy go na język polski, przelicza miary na system metryczny, weryfikuje multimedia i zapisuje gotowy plik JSON w repozytorium.

- **Wersja produkcyjna (GitHub Pages):** https://phxphoenix.github.io/Ulubione-przepisy-Kasi/
- **Wersja Vercel:** https://ulubione-przepisy-kasi.vercel.app

---

## Najważniejsze funkcje

- **Katalog z inteligentnym wyszukiwaniem** (`RecipeCatalog.tsx`) — filtrowanie po tytule, tagach i składnikach bez rozróżniania polskich znaków diakrytycznych (np. `zurek` znajduje `Żurek`), dynamiczne liczniki dla 6 kategorii oraz sortowanie (najnowsze, najszybsze, alfabetyczne A–Z).
- **Interaktywna karta przepisu** (`RecipeDetailView.tsx`):
  - **Przelicznik porcji** (`IngredientsList.tsx`) — przyciski `+`/`-` oraz szybkie mnożniki (`0.5x`, `1x`, `2x`) z automatycznym zaokrąglaniem i polskim formatowaniem liczb.
  - **Lista zakupów i odhaczanie składników** — stan zaznaczenia zapisywany w `sessionStorage` oraz jednoklikowe kopiowanie sformatowanej listy zakupów do schowka.
  - **Tryb gotowania** (`RecipeSteps.tsx`) — zaznaczanie aktywnego i ukończonych kroków oraz blokada wygaszania ekranu (Screen Wake Lock API).
  - **Galeria zdjęć i osadzone wideo** (`RecipeGallery.tsx`, `VideoEmbeds.tsx`) — obsługa YouTube (w tym Shorts), Instagram Reels, TikTok oraz bezpośrednich plików MP4.
- **Dodawanie i usuwanie przepisów prosto z interfejsu** (`AddRecipeModal.tsx`, `DeleteRecipeModal.tsx`, `RecipeGenerationTracker.tsx`) — wywołanie workflow GitHub Actions z poziomu przeglądarki przy użyciu Fine-Grained Personal Access Token (zapisanego lokalnie w `localStorage`) oraz **Instant Preview**, dzięki któremu nowy przepis pojawia się w aplikacji natychmiast po zakończeniu pracy agenta AI, zanim zakończy się pełny rebuild strony statycznej.
- **Magic Link (parowanie urządzeń)** — generowanie linku z tokenem w fragmencie URL (`#token=...`), automatycznie zapisywanego w `localStorage` i usuwanego z paska adresu przez `history.replaceState`.

---

## Stos technologiczny

| Warstwa | Technologie |
| --- | --- |
| **Frontend & SSG** | Astro 5, React 19, TypeScript (strict), Tailwind CSS v4, Lucide Icons |
| **Walidacja danych** | Astro Content Collections (`astro/zod`) + Pydantic v2 (Python) |
| **Agent AI & Scraping** | Python 3.12+, BeautifulSoup4, Requests, `r.jina.ai`, `python-slugify` |
| **Kaskada modeli AI** | Poziom 1: Google Gemini Developer API · Poziom 2: OpenRouter Free · Poziom 3: Groq Cloud |
| **Automatyzacja i hosting** | GitHub Actions (`add-recipe.yml`, `delete-recipe.yml`, `deploy.yml`, `ci.yml`), GitHub Pages, Vercel |
| **Testy** | Vitest, React Testing Library, `jsdom`, Python `unittest` |

---

## Szybki start (lokalnie)

### Wymagania wstępne

- **Node.js** `>= 20` (zalecane `22` zgodnie z CI) i `npm`
- **Python** `>= 3.12` oraz `pip` (do uruchamiania skryptów agenta AI i testów Pythona)

### Instalacja i uruchomienie frontendu

```bash
npm install
npm run dev
```

Aplikacja będzie dostępna pod adresem `http://localhost:4321`.

### Budowanie wersji produkcyjnej

```bash
npm run build
```

Polecenie wykonuje kolejno `astro check` (kontrola typów TypeScript i plików Astro) oraz `astro build` (generowanie statycznego serwisu w katalogu `dist/`).

> **Wskazówka dla systemu Windows (PowerShell):** jeśli polityka wykonywania skryptów blokuje `npm.ps1`, używaj `npm.cmd` (np. `npm.cmd run build`, `npm.cmd test`).

---

## Konfiguracja GitHub Actions i tokenu z UI

### 1. Sekrety repozytorium (dla workflow `Dodaj przepis z URL`)

W ustawieniach repozytorium GitHub (**Settings → Secrets and variables → Actions**) należy dodać co najmniej jeden darmowy klucz API (zalecane wszystkie trzy dla pełnej kaskady fallback):

- `GEMINI_API_KEY` — klucz Google Gemini Developer API (Poziom 1)
- `OPENROUTER_API_KEY` — klucz OpenRouter (Poziom 2, modele `:free`)
- `GROQ_API_KEY` — klucz Groq Cloud (Poziom 3)

### 2. Token dostępu w przeglądarce (Fine-Grained PAT)

Aby uruchamiać dodawanie i usuwanie przepisów bezpośrednio z aplikacji webowej, utwórz na GitHubie **Fine-Grained Personal Access Token** ograniczony wyłącznie do tego repozytorium z uprawnieniami:

- **Actions:** `Read and write`
- **Contents:** `Read-only` (do odczytu listy wygenerowanych plików w trybie Instant Preview)

Token zapisujesz w oknie ustawień przycisku **Dodaj przepis**, a następnie możesz wygenerować **Magic Link**, aby wygodnie sparować telefon.

---

## Uruchamianie testów

```bash
# Testy jednostkowe, komponentów React i integralności plików JSON przepisów
npm test

# Kontrola typów Astro + TypeScript
npm run check

# Testy jednostkowe skryptów Pythona (generate_recipe.py i delete_recipe.py)
npm run test:py
```

Więcej szczegółów znajduje się w [docs/TESTING.md](docs/TESTING.md).

---

## Struktura projektu

```text
├── .github/workflows/
│   ├── add-recipe.yml          # Workflow AI: pobranie przepisu z URL i commit JSON + zdjęć
│   ├── delete-recipe.yml       # Workflow bezpiecznego usuwania przepisu i osieroconych zdjęć
│   ├── deploy.yml              # Budowanie i wdrażanie Astro na GitHub Pages
│   └── ci.yml                  # Automatyczne testy Vitest, Astro check/build i Python unittest
├── docs/
│   ├── ARCHITECTURE.md         # Architektura, przepływ danych i schemat JSON przepisu
│   ├── AI_AGENT.md             # Szczegóły scrapera, filtracji zdjęć i kaskady 3 modeli AI
│   └── TESTING.md              # Dokumentacja zestawu testów i konfiguracji CI
├── public/
│   └── images/recipes/         # Lokalne kopie zdjęć z tymczasowych CDN (np. Facebook)
├── scripts/
│   ├── generate_recipe.py      # Główny agent AI (scraping, multimedia, kaskada LLM, walidacja)
│   ├── delete_recipe.py        # Skrypt bezpiecznego usuwania przepisu i czyszczenia grafik
│   ├── requirements.txt        # Zależności Pythona
│   ├── test_generate_recipe.py # Testy jednostkowe agenta AI
│   └── test_delete_recipe.py   # Testy jednostkowe skryptu usuwania
├── src/
│   ├── components/             # Interaktywne komponenty React (katalog, szczegóły, modale, tracker)
│   ├── constants/              # Definicje 6 kategorii i metadanych wizualnych
│   ├── content/recipes/        # Kolekcja przepisów w formacie JSON (źródło prawdy)
│   ├── layouts/                # Główny layout HTML/Astro (MainLayout.astro)
│   ├── pages/                  # Strona główna i dynamiczne trasy /przepis/[slug]
│   ├── schemas/                # Schemat Zod dla Astro Content Collections
│   ├── types/                  # Typy TypeScript generowane ze schematu Zod
│   └── utils/                  # Klient GitHub API, localStorage/Instant Preview, formatery, ścieżki
├── tests/
│   ├── components/             # Testy komponentów React (Testing Library)
│   └── unit/                   # Testy narzędzi, schematu, klienta GitHub i integralności treści
├── astro.config.mjs            # Konfiguracja Astro (automatyczne site/base dla GitHub Actions)
├── vitest.config.ts            # Konfiguracja środowiska testowego Vitest + jsdom
└── package.json
```

---

## Dokumentacja szczegółowa

- [Architektura aplikacji i model danych](docs/ARCHITECTURE.md)
- [Agent AI, scraping i obsługa multimediów](docs/AI_AGENT.md)
- [Zestaw testów i weryfikacja CI](docs/TESTING.md)
