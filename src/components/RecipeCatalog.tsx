import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Clock,
  Globe,
  LayoutGrid,
  Play,
  RotateCcw,
  Search,
  SearchX,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  CATEGORIES,
  CATEGORY_NAMES,
  getCategoryMeta,
  type RecipeCategory,
} from '../constants/categories';
import type {
  IngredientGroup,
  Recipe,
  RecipeDifficulty,
  RecipeImage,
  RecipeVideo,
} from '../types/recipe';
import {
  dispatchDeleteRecipeWorkflow,
  GitHubApiError,
} from '../utils/githubClient';
import {
  DELETED_RECIPES_STORAGE_KEY,
  getStoredDeletedRecipes,
  getStoredInstantRecipes,
  INSTANT_RECIPES_STORAGE_KEY,
  markRecipeAsDeleted,
  pruneBuiltInstantRecipes,
  pruneDeletedRecipes,
  RECIPE_ADDED_EVENT,
  RECIPE_DELETED_EVENT,
  requestOpenAddRecipeModal,
  requestOpenInstantRecipe,
} from '../utils/instantRecipes';
import { withBase } from '../utils/paths';
import {
  DIFFICULTY_BADGE_CLASSES,
  formatRecipeCount,
  formatTotalTime,
} from '../utils/recipe';
import DeleteRecipeModal, {
  type DeleteRecipePreview,
} from './DeleteRecipeModal';

export interface CatalogRecipe {
  slug: string;
  title: string;
  summary: string;
  category: RecipeCategory;
  tags: string[];
  totalTimeMinutes: number;
  difficulty: RecipeDifficulty;
  images: RecipeImage[];
  videos?: RecipeVideo[];
  ingredientGroups?: IngredientGroup[];
  ingredientNames?: string[];
  sourceDomain: string;
  createdAt: string;
  isInstantNew?: boolean;
  isStaticBuilt?: boolean;
  fullRecipe?: Recipe;
}

export interface RecipeCatalogProps {
  recipes: CatalogRecipe[];
}

type CategoryFilter = 'Wszystkie' | RecipeCategory;
type SortOption = 'newest' | 'fastest' | 'alphabetical';

interface IndexedRecipe {
  recipe: CatalogRecipe;
  searchText: string;
  createdAtMs: number;
}

const ALL_CATEGORY: CategoryFilter = 'Wszystkie';

const SORT_OPTIONS: readonly { value: SortOption; label: string }[] = [
  { value: 'newest', label: 'Najnowsze' },
  { value: 'fastest', label: 'Najszybsze (czas całkowity)' },
  { value: 'alphabetical', label: 'Alfabetycznie A-Z' },
];

const POLISH_DIACRITICS_MAP: Record<string, string> = {
  ą: 'a',
  ć: 'c',
  ę: 'e',
  ł: 'l',
  ń: 'n',
  ó: 'o',
  ś: 's',
  ź: 'z',
  ż: 'z',
};

function normalizeSearchText(value: string): string {
  return value
    .toLocaleLowerCase('pl')
    .replace(/[ąćęłńóśźż]/g, (char) => POLISH_DIACRITICS_MAP[char] ?? char)
    .replace(/\s+/g, ' ')
    .trim();
}

function extractIngredientNames(recipe: CatalogRecipe): string[] {
  if (recipe.ingredientNames && recipe.ingredientNames.length > 0) {
    return recipe.ingredientNames;
  }
  if (!recipe.ingredientGroups) {
    return [];
  }
  return recipe.ingredientGroups.flatMap((group) =>
    group.items.map((item) => item.name)
  );
}

function createEmptyCategoryCounts(): Record<RecipeCategory, number> {
  return CATEGORY_NAMES.reduce(
    (acc, name) => {
      acc[name] = 0;
      return acc;
    },
    {} as Record<RecipeCategory, number>
  );
}

interface RecipeCardImageProps {
  image?: RecipeImage;
  title: string;
  category: RecipeCategory;
  hasVideo: boolean;
  isInstantNew?: boolean;
  priority?: boolean;
}

function RecipeCardImage({
  image,
  title,
  category,
  hasVideo,
  isInstantNew = false,
  priority = false,
}: RecipeCardImageProps) {
  const resolvedSrc = image?.url ? withBase(image.url) : '';
  const [hasError, setHasError] = useState(!resolvedSrc);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const categoryMeta = getCategoryMeta(category);
  const CategoryIcon = categoryMeta.icon;

  useEffect(() => {
    if (!resolvedSrc) {
      setHasError(true);
      return;
    }

    setHasError(false);

    // Catch images that already failed to load before React hydration
    const imgEl = imgRef.current;
    if (imgEl && imgEl.complete && imgEl.naturalWidth === 0) {
      setHasError(true);
    }
  }, [resolvedSrc]);

  return (
    <div className="relative aspect-[16/10] w-full overflow-hidden bg-[#F3EEE7]">
      {!hasError && resolvedSrc ? (
        <>
          <img
            ref={imgRef}
            src={resolvedSrc}
            alt={image?.caption || title}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            onError={() => setHasError(true)}
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#1F2421]/20 via-transparent to-transparent"
          />
        </>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2.5 bg-gradient-to-br from-[#FAF8F5] via-[#F2EDE4] to-[#E6DFD5] px-4 text-center">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#EAE5DF] bg-white/80 shadow-xs"
            style={{ color: categoryMeta.accentColor }}
          >
            <CategoryIcon className="h-6 w-6" aria-hidden="true" />
          </div>
          <span className="text-xs font-medium text-[#1F2421]/55">
            {categoryMeta.name}
          </span>
        </div>
      )}

      {isInstantNew ? (
        <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-[#4A6B53]/95 px-2.5 py-1 text-xs font-bold text-white shadow-sm backdrop-blur-xs">
          <Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>Nowość – właśnie dodano!</span>
        </span>
      ) : null}

      {hasVideo ? (
        <span className="absolute top-3 right-3 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-[#1F2421]/80 px-2.5 py-1 text-xs font-semibold text-white shadow-sm backdrop-blur-xs">
          <Play className="h-3 w-3 fill-current" aria-hidden="true" />
          <span>Wideo</span>
        </span>
      ) : null}
    </div>
  );
}

interface RecipeCardProps {
  recipe: CatalogRecipe;
  priority?: boolean;
  onRequestDelete: (recipe: CatalogRecipe) => void;
}

function RecipeCard({
  recipe,
  priority = false,
  onRequestDelete,
}: RecipeCardProps) {
  const categoryMeta = getCategoryMeta(recipe.category);
  const CategoryIcon = categoryMeta.icon;
  const mainImage =
    recipe.images.find((img) => img.isMain) ?? recipe.images[0];
  const hasVideo = Boolean(recipe.videos && recipe.videos.length > 0);
  const recipeHref = withBase(`/przepis/${recipe.slug}`);

  return (
    <article className="catalog-item-enter group relative flex flex-col overflow-hidden rounded-2xl border border-[#EAE5DF] bg-white shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-[#4A6B53]/35 hover:shadow-md has-[a:active]:scale-[0.99] has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-[#4A6B53] has-[a:focus-visible]:ring-offset-2 has-[a:focus-visible]:ring-offset-[#FAF8F5] touch-manipulation">
      <RecipeCardImage
        image={mainImage}
        title={recipe.title}
        category={recipe.category}
        hasVideo={hasVideo}
        isInstantNew={recipe.isInstantNew}
        priority={priority}
      />

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-2">
          <span
            className={`inline-flex w-fit items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${categoryMeta.badgeClass}`}
          >
            <CategoryIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{recipe.category}</span>
          </span>

          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRequestDelete(recipe);
            }}
            aria-label={`Usuń przepis ${recipe.title}`}
            title="Usuń przepis"
            className="relative z-10 -mt-1 -mr-1 inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-[#EAE5DF]/80 bg-[#FAF8F5]/75 text-[#1F2421]/45 transition-all duration-150 before:absolute before:-inset-1 before:content-[''] hover:border-[#F2CED6] hover:bg-[#FCF0F2] hover:text-[#A24156] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A24156] focus-visible:ring-offset-2 focus-visible:ring-offset-white touch-manipulation"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <h3 className="mt-3 font-serif text-lg font-bold leading-snug text-[#1F2421] transition-colors group-hover:text-[#4A6B53] sm:text-xl">
          <a
            href={recipeHref}
            onClick={(event) => {
              if (!recipe.isStaticBuilt && recipe.fullRecipe) {
                event.preventDefault();
                requestOpenInstantRecipe(recipe.fullRecipe);
              }
            }}
            className="block focus:outline-none after:absolute after:inset-0 after:z-0"
          >
            <span className="line-clamp-2">{recipe.title}</span>
          </a>
        </h3>

        <p className="mt-2 flex-1 text-sm leading-relaxed text-[#1F2421]/70 line-clamp-3">
          {recipe.summary}
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-[#EAE5DF]/80 pt-3.5 text-xs font-medium text-[#1F2421]/65">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Clock
                className="h-3.5 w-3.5 shrink-0 text-[#4A6B53]"
                aria-hidden="true"
              />
              <span>{formatTotalTime(recipe.totalTimeMinutes)}</span>
            </span>

            <span
              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${DIFFICULTY_BADGE_CLASSES[recipe.difficulty]}`}
            >
              {recipe.difficulty}
            </span>
          </div>

          <span className="inline-flex max-w-full items-center gap-1 truncate text-[#1F2421]/55">
            <Globe
              className="h-3.5 w-3.5 shrink-0 text-[#C86D51]/80"
              aria-hidden="true"
            />
            <span className="truncate">{recipe.sourceDomain}</span>
          </span>
        </div>
      </div>
    </article>
  );
}

interface EmptyStateProps {
  totalRecipes: number;
  searchQuery: string;
  selectedCategory: CategoryFilter;
  onResetFilters: () => void;
}

function EmptyState({
  totalRecipes,
  searchQuery,
  selectedCategory,
  onResetFilters,
}: EmptyStateProps) {
  const hasFilters =
    searchQuery.trim().length > 0 || selectedCategory !== ALL_CATEGORY;

  return (
    <div className="catalog-item-enter mx-auto my-6 max-w-lg rounded-2xl border border-dashed border-[#EAE5DF] bg-white px-6 py-12 text-center shadow-xs sm:py-14">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-[#EAE5DF] bg-[#FAF8F5] text-[#C86D51]">
        {totalRecipes === 0 ? (
          <BookOpen className="h-8 w-8" aria-hidden="true" />
        ) : (
          <SearchX className="h-8 w-8" aria-hidden="true" />
        )}
      </div>

      <h3 className="font-serif text-xl font-bold text-[#1F2421]">
        {totalRecipes === 0
          ? 'Książka kucharska jest jeszcze pusta'
          : 'Nie znaleziono pasujących przepisów'}
      </h3>

      <p className="mt-2 text-sm leading-relaxed text-[#1F2421]/65">
        {totalRecipes === 0
          ? 'Dodaj pierwszy przepis do kolekcji, aby zacząć budować domowy zbiór ulubionych dań.'
          : searchQuery.trim().length > 0 && selectedCategory !== ALL_CATEGORY
            ? `Brak wyników dla „${searchQuery.trim()}” w kategorii „${selectedCategory}”. Spróbuj wyczyścić filtry lub zmienić kategorię.`
            : searchQuery.trim().length > 0
              ? `Nie znaleziono przepisów pasujących do frazy „${searchQuery.trim()}”. Sprawdź pisownię lub wpisz inny składnik.`
              : `W kategorii „${selectedCategory}” nie ma jeszcze zapisanych przepisów.`}
      </p>

      {hasFilters ? (
        <button
          type="button"
          onClick={onResetFilters}
          className="mt-6 inline-flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#4A6B53] px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:bg-[#3B5542] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-[#4A6B53]/50 focus:ring-offset-2 focus:ring-offset-white touch-manipulation"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          <span>Resetuj filtry</span>
        </button>
      ) : null}
    </div>
  );
}

function toCatalogRecipeFromFull(recipe: Recipe): CatalogRecipe {
  const mainImage =
    recipe.images.find((img) => img.isMain) ?? recipe.images[0];
  const ingredientNames = Array.from(
    new Set(
      recipe.ingredientGroups.flatMap((group) =>
        group.items.map((item) => item.name)
      )
    )
  );

  return {
    slug: recipe.slug,
    title: recipe.title,
    summary: recipe.summary,
    category: recipe.category,
    tags: recipe.tags ?? [],
    totalTimeMinutes: recipe.totalTimeMinutes,
    difficulty: recipe.difficulty,
    images: mainImage ? [mainImage] : [],
    videos: recipe.videos && recipe.videos.length > 0 ? [recipe.videos[0]] : [],
    ingredientNames,
    sourceDomain: recipe.sourceDomain,
    createdAt: recipe.createdAt,
    isInstantNew: true,
    isStaticBuilt: false,
    fullRecipe: recipe,
  };
}

export default function RecipeCatalog({ recipes }: RecipeCatalogProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] =
    useState<CategoryFilter>(ALL_CATEGORY);
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [instantRecipes, setInstantRecipes] = useState<Recipe[]>([]);
  const [deletedSlugs, setDeletedSlugs] = useState<string[]>([]);
  const [recipeToDelete, setRecipeToDelete] =
    useState<DeleteRecipePreview | null>(null);
  const [isDeletingRecipe, setIsDeletingRecipe] = useState(false);
  const [deleteError, setDeleteError] = useState<{
    message: string;
    code?: string;
  } | null>(null);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);

  const deleteNoticeTimerRef = useRef<number | null>(null);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const staticSlugs = useMemo(
    () => new Set(recipes.map((recipe) => recipe.slug)),
    [recipes]
  );

  useEffect(() => {
    pruneBuiltInstantRecipes(staticSlugs);
    pruneDeletedRecipes(staticSlugs);

    function syncInstantRecipes() {
      const stored = getStoredInstantRecipes();
      setInstantRecipes(stored.map((entry) => entry.recipe));
    }

    function syncDeletedRecipes() {
      const stored = getStoredDeletedRecipes();
      setDeletedSlugs(stored.map((entry) => entry.slug));
    }

    syncInstantRecipes();
    syncDeletedRecipes();

    function handleRecipeAdded() {
      syncInstantRecipes();
      syncDeletedRecipes();
    }

    function handleRecipeDeleted() {
      syncInstantRecipes();
      syncDeletedRecipes();
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === INSTANT_RECIPES_STORAGE_KEY) {
        syncInstantRecipes();
      } else if (event.key === DELETED_RECIPES_STORAGE_KEY) {
        syncDeletedRecipes();
      }
    }

    window.addEventListener(RECIPE_ADDED_EVENT, handleRecipeAdded);
    window.addEventListener(RECIPE_DELETED_EVENT, handleRecipeDeleted);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(RECIPE_ADDED_EVENT, handleRecipeAdded);
      window.removeEventListener(RECIPE_DELETED_EVENT, handleRecipeDeleted);
      window.removeEventListener('storage', handleStorage);
    };
  }, [staticSlugs]);

  useEffect(() => {
    return () => {
      if (deleteNoticeTimerRef.current !== null) {
        window.clearTimeout(deleteNoticeTimerRef.current);
      }
    };
  }, []);

  const mergedRecipes = useMemo<CatalogRecipe[]>(() => {
    const deletedSlugSet = new Set(deletedSlugs);
    const instantSlugSet = new Set(instantRecipes.map((recipe) => recipe.slug));

    const dynamicTopItems: CatalogRecipe[] = instantRecipes
      .filter(
        (recipe) =>
          !staticSlugs.has(recipe.slug) && !deletedSlugSet.has(recipe.slug)
      )
      .map((recipe) => toCatalogRecipeFromFull(recipe));

    const staticItems: CatalogRecipe[] = recipes
      .filter((recipe) => !deletedSlugSet.has(recipe.slug))
      .map((recipe) => ({
        ...recipe,
        isStaticBuilt: true,
        isInstantNew: instantSlugSet.has(recipe.slug),
      }));

    return [...dynamicTopItems, ...staticItems];
  }, [deletedSlugs, instantRecipes, recipes, staticSlugs]);

  const indexedRecipes = useMemo<IndexedRecipe[]>(() => {
    return mergedRecipes.map((recipe) => {
      const ingredients = extractIngredientNames(recipe);
      const searchText = normalizeSearchText(
        [recipe.title, ...recipe.tags, ...ingredients].join(' ')
      );
      const parsedDate = Date.parse(recipe.createdAt);

      return {
        recipe,
        searchText,
        createdAtMs: Number.isNaN(parsedDate) ? 0 : parsedDate,
      };
    });
  }, [mergedRecipes]);

  const { searchMatchedRecipes, categoryCounts } = useMemo(() => {
    const normalizedQuery = normalizeSearchText(deferredSearchQuery);
    const tokens = normalizedQuery ? normalizedQuery.split(' ') : [];
    const counts = createEmptyCategoryCounts();
    const matched: IndexedRecipe[] = [];

    for (const item of indexedRecipes) {
      const matchesSearch =
        tokens.length === 0 ||
        tokens.every((token) => item.searchText.includes(token));

      if (!matchesSearch) {
        continue;
      }

      matched.push(item);
      counts[item.recipe.category] = (counts[item.recipe.category] ?? 0) + 1;
    }

    return {
      searchMatchedRecipes: matched,
      categoryCounts: counts,
    };
  }, [indexedRecipes, deferredSearchQuery]);

  const sortedRecipes = useMemo(() => {
    const categoryFiltered =
      selectedCategory === ALL_CATEGORY
        ? searchMatchedRecipes
        : searchMatchedRecipes.filter(
            (item) => item.recipe.category === selectedCategory
          );

    const copy = [...categoryFiltered];
    copy.sort((a, b) => {
      if (sortBy === 'fastest') {
        return (
          a.recipe.totalTimeMinutes - b.recipe.totalTimeMinutes ||
          b.createdAtMs - a.createdAtMs
        );
      }
      if (sortBy === 'alphabetical') {
        return a.recipe.title.localeCompare(b.recipe.title, 'pl', {
          sensitivity: 'base',
        });
      }
      // 'newest' (default): pin newly added instant-preview recipes at the very top
      const aNew = a.recipe.isInstantNew ? 1 : 0;
      const bNew = b.recipe.isInstantNew ? 1 : 0;
      return (
        bNew - aNew ||
        b.createdAtMs - a.createdAtMs ||
        a.recipe.title.localeCompare(b.recipe.title, 'pl', {
          sensitivity: 'base',
        })
      );
    });

    return copy.map((item) => item.recipe);
  }, [searchMatchedRecipes, selectedCategory, sortBy]);

  const hasActiveFilters =
    searchQuery.trim().length > 0 || selectedCategory !== ALL_CATEGORY;

  function handleResetFilters() {
    setSearchQuery('');
    setSelectedCategory(ALL_CATEGORY);
  }

  function handleRequestDelete(recipe: CatalogRecipe) {
    const mainImage =
      recipe.images.find((img) => img.isMain) ?? recipe.images[0];
    setDeleteError(null);
    setRecipeToDelete({
      slug: recipe.slug,
      title: recipe.title,
      category: recipe.category,
      totalTimeMinutes: recipe.totalTimeMinutes,
      imageUrl: mainImage?.url,
      imageCaption: mainImage?.caption,
    });
  }

  function handleCancelDelete() {
    if (isDeletingRecipe) {
      return;
    }
    setRecipeToDelete(null);
    setDeleteError(null);
  }

  function handleOpenSettingsFromDelete() {
    setRecipeToDelete(null);
    setDeleteError(null);
    requestOpenAddRecipeModal({ initialView: 'settings' });
  }

  async function handleConfirmDelete(target: DeleteRecipePreview) {
    if (isDeletingRecipe) {
      return;
    }

    setIsDeletingRecipe(true);
    setDeleteError(null);

    try {
      await dispatchDeleteRecipeWorkflow(target.slug);
      markRecipeAsDeleted(target.slug);
      setRecipeToDelete(null);
      setDeleteNotice(
        `Usunięto przepis „${target.title}”. Zmiana zapisuje się w repozytorium (strona statyczna zaktualizuje się w tle za ok. 1–2 min).`
      );
      if (deleteNoticeTimerRef.current !== null) {
        window.clearTimeout(deleteNoticeTimerRef.current);
      }
      deleteNoticeTimerRef.current = window.setTimeout(() => {
        setDeleteNotice(null);
      }, 9000);
    } catch (error) {
      if (error instanceof GitHubApiError) {
        setDeleteError({ message: error.message, code: error.code });
      } else {
        setDeleteError({
          message:
            'Wystąpił nieoczekiwany błąd podczas zlecania usunięcia przepisu.',
          code: 'UNKNOWN',
        });
      }
    } finally {
      setIsDeletingRecipe(false);
    }
  }

  return (
    <section aria-label="Katalog przepisów" className="pb-10">
      {deleteNotice ? (
        <div
          role="status"
          aria-live="polite"
          className="catalog-item-enter mb-5 flex items-center justify-between gap-3 rounded-2xl border border-[#C9DBC9] bg-[#EDF3EE] px-4 py-3.5 text-xs font-semibold text-[#3B5542] shadow-sm sm:text-sm"
        >
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#4A6B53] text-white">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            </div>
            <span>{deleteNotice}</span>
          </div>

          <button
            type="button"
            onClick={() => setDeleteNotice(null)}
            aria-label="Zamknij powiadomienie"
            className="flex min-h-[36px] min-w-[36px] shrink-0 cursor-pointer items-center justify-center rounded-lg text-[#3B5542]/70 transition-colors hover:bg-[#4A6B53]/10 hover:text-[#3B5542] touch-manipulation"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {/* Search and sort controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <label htmlFor="recipe-search" className="sr-only">
            Szukaj przepisów po tytule, tagach lub składnikach
          </label>
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 h-5 w-5 -translate-y-1/2 text-[#1F2421]/45"
            aria-hidden="true"
          />
          <input
            id="recipe-search"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Szukaj przepisu, składnika (np. cukinia) lub tagu..."
            className="min-h-[48px] w-full rounded-xl border border-[#EAE5DF] bg-white py-2.5 pr-12 pl-11 text-base text-[#1F2421] shadow-xs transition-all placeholder:text-[#1F2421]/45 focus:border-[#4A6B53] focus:outline-none focus:ring-2 focus:ring-[#4A6B53]/20 sm:text-sm"
          />
          {searchQuery.length > 0 ? (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Wyczyść wyszukiwanie"
              className="absolute top-1/2 right-1 flex min-h-[44px] min-w-[44px] -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-[#1F2421]/50 transition-all hover:bg-[#FAF8F5] hover:text-[#1F2421] active:scale-95 touch-manipulation"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <div className="relative shrink-0 sm:w-64">
          <label htmlFor="recipe-sort" className="sr-only">
            Sortuj przepisy
          </label>
          <ArrowUpDown
            className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[#4A6B53]"
            aria-hidden="true"
          />
          <select
            id="recipe-sort"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as SortOption)}
            className="min-h-[48px] w-full cursor-pointer appearance-none rounded-xl border border-[#EAE5DF] bg-white py-2.5 pr-10 pl-10 text-base font-medium text-[#1F2421] shadow-xs transition-all focus:border-[#4A6B53] focus:outline-none focus:ring-2 focus:ring-[#4A6B53]/20 sm:text-sm touch-manipulation"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-3.5 h-4 w-4 -translate-y-1/2 text-[#1F2421]/50"
            aria-hidden="true"
          />
        </div>
      </div>

      {/* Horizontal swipeable category pills (hidden scrollbar for iPhone) */}
      <div className="mt-4 -mx-4 px-4 sm:mx-0 sm:px-0">
        <div
          role="group"
          aria-label="Kategorie przepisów"
          className="no-scrollbar flex items-center gap-2 overflow-x-auto overscroll-x-contain pb-1"
        >
          <button
            type="button"
            onClick={() => setSelectedCategory(ALL_CATEGORY)}
            aria-pressed={selectedCategory === ALL_CATEGORY}
            className={`inline-flex min-h-[44px] shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold transition-all duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6B53] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAF8F5] touch-manipulation ${
              selectedCategory === ALL_CATEGORY
                ? 'border-[#1F2421] bg-[#1F2421] text-white shadow-sm'
                : 'border-[#EAE5DF] bg-white text-[#1F2421]/80 hover:border-[#4A6B53]/40 hover:text-[#1F2421]'
            }`}
          >
            <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Wszystkie</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${
                selectedCategory === ALL_CATEGORY
                  ? 'bg-white/20 text-white'
                  : 'border border-[#EAE5DF] bg-[#FAF8F5] text-[#1F2421]/65'
              }`}
            >
              {searchMatchedRecipes.length}
            </span>
          </button>

          {CATEGORIES.map((category) => {
            const Icon = category.icon;
            const isSelected = selectedCategory === category.name;
            const count = categoryCounts[category.name] ?? 0;

            return (
              <button
                key={category.slug}
                type="button"
                onClick={() => setSelectedCategory(category.name)}
                aria-pressed={isSelected}
                className={`inline-flex min-h-[44px] shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold transition-all duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6B53] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAF8F5] touch-manipulation ${
                  isSelected
                    ? `${category.activeButtonClass} shadow-sm`
                    : 'border-[#EAE5DF] bg-white text-[#1F2421]/80 hover:border-[#4A6B53]/40 hover:text-[#1F2421]'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{category.name}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${
                    isSelected
                      ? 'bg-white/20 text-white'
                      : count === 0
                        ? 'border border-[#EAE5DF] bg-[#FAF8F5] text-[#1F2421]/40'
                        : 'border border-[#EAE5DF] bg-[#FAF8F5] text-[#1F2421]/65'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Results count & quick filter reset bar */}
      <div className="mt-4 mb-5 flex min-h-[44px] flex-wrap items-center justify-between gap-2">
        <p
          aria-live="polite"
          className="text-xs font-medium text-[#1F2421]/60 sm:text-sm"
        >
          {hasActiveFilters ? (
            <>
              Znaleziono{' '}
              <span className="font-semibold text-[#1F2421]">
                {formatRecipeCount(sortedRecipes.length)}
              </span>
              {selectedCategory !== ALL_CATEGORY
                ? ` w kategorii ${selectedCategory}`
                : ''}
            </>
          ) : (
            <>
              W kolekcji:{' '}
              <span className="font-semibold text-[#1F2421]">
                {formatRecipeCount(sortedRecipes.length)}
              </span>
            </>
          )}
        </p>

        {hasActiveFilters ? (
          <button
            type="button"
            onClick={handleResetFilters}
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold text-[#C86D51] transition-all hover:bg-[#C86D51]/10 hover:text-[#B35B40] active:scale-[0.98] sm:text-sm touch-manipulation"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Wyczyść filtry</span>
          </button>
        ) : null}
      </div>

      {/* Recipes Grid or Empty State */}
      {sortedRecipes.length > 0 ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 sm:gap-6">
          {sortedRecipes.map((recipe, index) => (
            <RecipeCard
              key={recipe.slug}
              recipe={recipe}
              priority={index < 3}
              onRequestDelete={handleRequestDelete}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          totalRecipes={mergedRecipes.length}
          searchQuery={searchQuery}
          selectedCategory={selectedCategory}
          onResetFilters={handleResetFilters}
        />
      )}

      <DeleteRecipeModal
        recipe={recipeToDelete}
        isDeleting={isDeletingRecipe}
        error={deleteError}
        onCancel={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        onOpenSettings={handleOpenSettingsFromDelete}
      />
    </section>
  );
}
