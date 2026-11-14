# Dokumentacja testów i CI

Projekt posiada wielowarstwowy zestaw testów automatycznych obejmujący logikę frontendową, komponenty React, integralność danych kolekcji przepisów oraz skrypty Pythona.

---

## 1. Zestaw testów Frontend & Content (Vitest + Testing Library)

Konfiguracja znajduje się w [vitest.config.ts](../vitest.config.ts) (środowisko `jsdom`, setup w [tests/setup.ts](../tests/setup.ts)).

### Uruchamianie lokalne

```bash
# Pojedyncze uruchomienie wszystkich testów JS/TS
npm test

# Tryb obserwacji podczas pracy
npm run test:watch

# Kontrola typów Astro + TypeScript oraz pełny build produkcyjny
npm run check
npm run build
```

> Na systemie Windows z restrykcyjną polityką PowerShell użyj `npm.cmd test` lub `npx.cmd vitest run`.

### Pokrycie testów frontendowych

| Plik testowy | Testowany obszar | Zakres weryfikacji |
| --- | --- | --- |
| `tests/unit/recipeUtils.test.ts` | `src/utils/recipe.ts`, `src/constants/categories.ts` | Formatowanie czasu, polska odmiana liczebników (`przepis`/`przepisy`/`przepisów`, `porcja`/`porcje`/`porcji`), skalowanie ilości składników, kolejność zdjęcia głównego, spójność metadanych 6 kategorii |
| `tests/unit/paths.test.ts` | `src/utils/paths.ts` | Rozwiązywanie ścieżek `withBase` dla `/` oraz podkatalogu `/Ulubione-przepisy-Kasi`, zachowanie adresów zewnętrznych i kotwic |
| `tests/unit/recipeSchema.test.ts` | `src/schemas/recipe.ts` + `src/content/recipes/*.json` | Walidacja reguł schematu Zod oraz **test integralności wszystkich plików JSON w repozytorium** (unikalność slugów, poprawność schematu, istnienie lokalnych plików zdjęć w `public/`) |
| `tests/unit/githubClient.test.ts` | `src/utils/githubClient.ts` | Zarządzanie tokenem w `localStorage`, zdarzenie `kasia:token-changed`, obsługa Magic Link (`?token=` i `#token=`), walidacja URL, normalizacja JSON, mapowanie błędów HTTP (401/403/404/rate-limit/network), fallback odczytu publicznego przy 403 oraz dekodowanie Base64 UTF-8 |
| `tests/unit/instantRecipes.test.ts` | `src/utils/instantRecipes.ts` | Zapisywanie i limit 15 przepisów Instant Preview, oznaczanie usuniętych przepisów, automatyczne wygaszanie wpisów (`pruneBuiltInstantRecipes`, `pruneDeletedRecipes`), stan trackera |
| `tests/components/IngredientsList.test.tsx` | `src/components/IngredientsList.tsx` | Przeliczanie składników przyciskami `+`/`-` oraz mnożnikami `0.5x`/`1x`/`2x`, zaznaczanie składników i zapis w `sessionStorage`, kopiowanie listy zakupów do schowka |
| `tests/components/RecipeCatalog.test.tsx` | `src/components/RecipeCatalog.tsx` | Wyszukiwanie niewrażliwe na polskie znaki diakrytyczne, filtrowanie po kategoriach, sortowanie (najszybsze, alfabetyczne), stan pusty z resetem filtrów oraz scalanie przepisów Instant Preview |

---

## 2. Zestaw testów Python (`unittest`)

Testy skryptów automatyzacji znajdują się w katalogu `scripts/` i korzystają z wbudowanego modułu `unittest` oraz `unittest.mock` (bez wykonywania prawdziwych zapytań sieciowych ani wywołań płatnych/zewnętrznych API).

### Uruchamianie lokalne

```bash
# Wymaga zainstalowanych zależności z scripts/requirements.txt
npm run test:py
# lub bezpośrednio:
python -m unittest discover -s scripts -p "test_*.py" -v
```

### Pokrycie testów Pythona

| Plik testowy | Testowany moduł | Zakres weryfikacji |
| --- | --- | --- |
| `scripts/test_generate_recipe.py` | `scripts/generate_recipe.py` | **Warstwa 0:** filtracja ikon UI Facebooka, parsowanie nagłówków PNG/JPEG, weryfikacja kandydatów (odrzucone vs niejednoznaczne). **Warstwa 1:** wykrywanie URL Facebooka, odzyskiwanie `og:title`/`og:image`, lokalne zapisywanie wygasających grafik CDN i aktualizacja kroków. **Warstwa 2:** przełączanie promptu na `imageSearchQueries` oraz fallback API. **Dodatkowo:** walidacja URL/domeny, normalizacja wideo (YouTube/Instagram/TikTok/MP4), rozwiązywanie `@graph` `@id` w JSON-LD i `srcset`, detekcja blokad antybotowych, kaskada AI (Gemini → OpenRouter → Groq), generowanie unikalnych slugów z polskimi znakami, sanityzacja i zapis `GITHUB_OUTPUT` |
| `scripts/test_delete_recipe.py` | `scripts/delete_recipe.py` | Walidacja bezpieczeństwa sluga (ochrona przed path traversal), usuwanie pliku JSON i nieużywanych zdjęć lokalnych, zachowanie zdjęć współdzielonych z innymi przepisami, tworzenie `.gitkeep` po usunięciu ostatniego przepisu, dopasowanie po `slug`/`id` wewnątrz JSON oraz kody wyjścia CLI i `GITHUB_OUTPUT` |

---

## 3. Ciągła integracja (GitHub Actions CI)

Workflow `.github/workflows/ci.yml` uruchamia się automatycznie przy każdym `push` i `pull_request` do gałęzi `main` (oraz ręcznie przez `workflow_dispatch`) i wykonuje dwa równoległe zadania:

1. **`frontend-tests`**: `npm ci` → `npm test` → `npm run build` (`astro check && astro build`).
2. **`python-tests`**: instalacja `scripts/requirements.txt` → `python -m unittest discover -s scripts -p "test_*.py" -v`.
