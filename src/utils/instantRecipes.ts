import type { Recipe } from '../types/recipe';

export const INSTANT_RECIPES_STORAGE_KEY = 'kasia_instant_recipes';
export const DELETED_RECIPES_STORAGE_KEY = 'kasia_deleted_recipes';
export const TRACKER_JOB_STORAGE_KEY = 'kasia_recipe_tracker_job';

export const OPEN_ADD_RECIPE_EVENT = 'kasia:open-add-recipe';
export const OPEN_INSTANT_RECIPE_EVENT = 'kasia:open-instant-recipe';
export const RECIPE_ADDED_EVENT = 'kasia:recipe-added';
export const RECIPE_DELETED_EVENT = 'kasia:recipe-deleted';
export const TRACKER_JOB_CHANGED_EVENT = 'kasia:tracker-job-changed';

export type TrackerStage =
  | 'queued'
  | 'in_progress'
  | 'fetching_preview'
  | 'completed'
  | 'error';

export interface ActiveTrackerJob {
  id: string;
  recipeUrl: string;
  stage: TrackerStage;
  startedAt: number;
  completedAt?: number;
  runId?: number;
  runHtmlUrl?: string;
  baselineRunIds: number[];
  baselineFilenames: string[];
  errorMessage?: string;
  errorCode?: string;
  recipe?: Recipe;
  matchedFilename?: string;
}

export interface StoredInstantRecipe {
  recipe: Recipe;
  addedAt: number;
}

export interface StoredDeletedRecipe {
  slug: string;
  deletedAt: number;
}

export interface OpenAddRecipeDetail {
  initialView?: 'form' | 'settings';
  prefillUrl?: string;
}

const MAX_INSTANT_RECIPES = 15;
const RECENT_STATIC_BADGE_WINDOW_MS = 10 * 60 * 1000;
const MIN_DELETED_RETENTION_MS = 5 * 60 * 1000;
const MAX_DELETED_RETENTION_MS = 15 * 60 * 1000;

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function writeJsonStorageList<T>(key: string, items: T[]): void {
  try {
    if (items.length === 0) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(items));
    }
  } catch {
    // Ignore storage quota or private browsing errors
  }
}

export function getStoredInstantRecipes(): StoredInstantRecipe[] {
  if (!isBrowser()) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(INSTANT_RECIPES_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item): item is StoredInstantRecipe =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as StoredInstantRecipe).addedAt === 'number' &&
        typeof (item as StoredInstantRecipe).recipe?.slug === 'string' &&
        typeof (item as StoredInstantRecipe).recipe?.title === 'string'
    );
  } catch {
    return [];
  }
}

export function getStoredDeletedRecipes(): StoredDeletedRecipe[] {
  if (!isBrowser()) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(DELETED_RECIPES_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item): item is StoredDeletedRecipe =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as StoredDeletedRecipe).slug === 'string' &&
        (item as StoredDeletedRecipe).slug.trim().length > 0 &&
        typeof (item as StoredDeletedRecipe).deletedAt === 'number'
    );
  } catch {
    return [];
  }
}

export function saveInstantRecipe(recipe: Recipe): StoredInstantRecipe[] {
  if (!isBrowser()) {
    return [];
  }
  const existing = getStoredInstantRecipes().filter(
    (entry) => entry.recipe.slug !== recipe.slug
  );
  const updated: StoredInstantRecipe[] = [
    { recipe, addedAt: Date.now() },
    ...existing,
  ].slice(0, MAX_INSTANT_RECIPES);

  writeJsonStorageList(INSTANT_RECIPES_STORAGE_KEY, updated);

  // If a recipe with this slug was previously deleted, ensure it isn't suppressed.
  const remainingDeleted = getStoredDeletedRecipes().filter(
    (entry) => entry.slug !== recipe.slug
  );
  writeJsonStorageList(DELETED_RECIPES_STORAGE_KEY, remainingDeleted);

  window.dispatchEvent(
    new CustomEvent<Recipe>(RECIPE_ADDED_EVENT, { detail: recipe })
  );
  return updated;
}

export function markRecipeAsDeleted(slug: string): StoredDeletedRecipe[] {
  if (!isBrowser()) {
    return [];
  }

  const remainingInstant = getStoredInstantRecipes().filter(
    (entry) => entry.recipe.slug !== slug
  );
  writeJsonStorageList(INSTANT_RECIPES_STORAGE_KEY, remainingInstant);

  const activeTracker = getStoredTrackerJob();
  if (activeTracker?.recipe?.slug === slug) {
    saveTrackerJob(null);
  }

  const existingDeleted = getStoredDeletedRecipes().filter(
    (entry) => entry.slug !== slug
  );
  const updatedDeleted: StoredDeletedRecipe[] = [
    { slug, deletedAt: Date.now() },
    ...existingDeleted,
  ];
  writeJsonStorageList(DELETED_RECIPES_STORAGE_KEY, updatedDeleted);

  window.dispatchEvent(
    new CustomEvent<{ slug: string }>(RECIPE_DELETED_EVENT, {
      detail: { slug },
    })
  );
  return updatedDeleted;
}

export function pruneBuiltInstantRecipes(staticSlugs: Set<string>): void {
  if (!isBrowser()) {
    return;
  }
  const now = Date.now();
  const current = getStoredInstantRecipes();
  const kept = current.filter(
    (entry) =>
      !staticSlugs.has(entry.recipe.slug) ||
      now - entry.addedAt < RECENT_STATIC_BADGE_WINDOW_MS
  );

  if (kept.length !== current.length) {
    writeJsonStorageList(INSTANT_RECIPES_STORAGE_KEY, kept);
  }
}

export function pruneDeletedRecipes(staticSlugs: Set<string>): void {
  if (!isBrowser()) {
    return;
  }
  const now = Date.now();
  const current = getStoredDeletedRecipes();
  const kept = current.filter((entry) => {
    const age = now - entry.deletedAt;
    return staticSlugs.has(entry.slug)
      ? age < MAX_DELETED_RETENTION_MS
      : age < MIN_DELETED_RETENTION_MS;
  });

  if (kept.length !== current.length) {
    writeJsonStorageList(DELETED_RECIPES_STORAGE_KEY, kept);
  }
}

export function getStoredTrackerJob(): ActiveTrackerJob | null {
  if (!isBrowser()) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(TRACKER_JOB_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<ActiveTrackerJob>;
    if (
      typeof parsed?.id === 'string' &&
      typeof parsed?.recipeUrl === 'string' &&
      typeof parsed?.stage === 'string' &&
      typeof parsed?.startedAt === 'number'
    ) {
      return {
        ...parsed,
        baselineRunIds: Array.isArray(parsed.baselineRunIds)
          ? parsed.baselineRunIds
          : [],
        baselineFilenames: Array.isArray(parsed.baselineFilenames)
          ? parsed.baselineFilenames
          : [],
      } as ActiveTrackerJob;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveTrackerJob(
  job: ActiveTrackerJob | null,
  options?: { emit?: boolean }
): void {
  if (!isBrowser()) {
    return;
  }
  try {
    if (!job) {
      window.localStorage.removeItem(TRACKER_JOB_STORAGE_KEY);
    } else {
      window.localStorage.setItem(TRACKER_JOB_STORAGE_KEY, JSON.stringify(job));
    }
  } catch {
    // Ignore storage errors
  }

  if (options?.emit !== false) {
    window.dispatchEvent(
      new CustomEvent<ActiveTrackerJob | null>(TRACKER_JOB_CHANGED_EVENT, {
        detail: job,
      })
    );
  }
}

export function requestOpenAddRecipeModal(detail?: OpenAddRecipeDetail): void {
  if (!isBrowser()) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<OpenAddRecipeDetail>(OPEN_ADD_RECIPE_EVENT, {
      detail: detail ?? {},
    })
  );
}

export function requestOpenInstantRecipe(recipe: Recipe): void {
  if (!isBrowser()) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<Recipe>(OPEN_INSTANT_RECIPE_EVENT, { detail: recipe })
  );
}
