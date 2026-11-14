import { describe, expect, it, vi } from 'vitest';
import type { Recipe } from '../../src/types/recipe';
import {
  DELETED_RECIPES_STORAGE_KEY,
  getStoredDeletedRecipes,
  getStoredInstantRecipes,
  getStoredTrackerJob,
  INSTANT_RECIPES_STORAGE_KEY,
  markRecipeAsDeleted,
  pruneBuiltInstantRecipes,
  pruneDeletedRecipes,
  RECIPE_ADDED_EVENT,
  RECIPE_DELETED_EVENT,
  saveInstantRecipe,
  saveTrackerJob,
  TRACKER_JOB_CHANGED_EVENT,
} from '../../src/utils/instantRecipes';

function makeRecipe(slug: string, title = `Przepis ${slug}`): Recipe {
  return {
    id: slug,
    slug,
    title,
    summary: 'Opis testowy.',
    category: 'Dania główne',
    tags: ['test'],
    totalTimeMinutes: 25,
    servings: 2,
    difficulty: 'Łatwy',
    images: [{ url: 'https://example.com/img.jpg', isMain: true }],
    videos: [],
    ingredientGroups: [{ items: [{ name: 'Makaron', amount: 200, unit: 'g' }] }],
    steps: [{ stepNumber: 1, instruction: 'Ugotuj makaron.' }],
    chefTips: [],
    sourceUrl: 'https://example.com/przepis',
    sourceDomain: 'example.com',
    originalLanguage: 'pl',
    createdAt: '2026-11-12T18:00:00.000Z',
  };
}

describe('instantRecipes localStorage helpers', () => {
  it('saves, deduplicates, caps at 15, and emits RECIPE_ADDED_EVENT', () => {
    const addedListener = vi.fn();
    window.addEventListener(RECIPE_ADDED_EVENT, addedListener);

    for (let i = 1; i <= 17; i += 1) {
      saveInstantRecipe(makeRecipe(`przepis-${i}`));
    }
    // Re-save an older recipe -> moves to front without duplicating
    saveInstantRecipe(makeRecipe('przepis-10', 'Zaktualizowany 10'));

    const stored = getStoredInstantRecipes();
    expect(stored).toHaveLength(15);
    expect(stored[0].recipe.slug).toBe('przepis-10');
    expect(stored[0].recipe.title).toBe('Zaktualizowany 10');
    expect(addedListener).toHaveBeenCalledTimes(18);

    window.removeEventListener(RECIPE_ADDED_EVENT, addedListener);
  });

  it('marks recipe as deleted, clears instant & active tracker job, and restores if re-added', () => {
    const deletedListener = vi.fn();
    window.addEventListener(RECIPE_DELETED_EVENT, deletedListener);

    const recipe = makeRecipe('kopytka');
    saveInstantRecipe(recipe);
    saveTrackerJob({
      id: 'job-1',
      recipeUrl: 'https://example.com/kopytka',
      stage: 'completed',
      startedAt: Date.now(),
      baselineRunIds: [],
      baselineFilenames: [],
      recipe,
    });

    markRecipeAsDeleted('kopytka');

    expect(getStoredInstantRecipes()).toHaveLength(0);
    expect(getStoredTrackerJob()).toBeNull();
    expect(getStoredDeletedRecipes().map((d) => d.slug)).toEqual(['kopytka']);
    expect(deletedListener).toHaveBeenCalledTimes(1);

    // Re-adding removes from deleted suppression list
    saveInstantRecipe(recipe);
    expect(getStoredDeletedRecipes()).toHaveLength(0);

    window.removeEventListener(RECIPE_DELETED_EVENT, deletedListener);
  });

  it('prunes built instant recipes older than 10 minutes and retains fresh ones', () => {
    const now = Date.now();
    window.localStorage.setItem(
      INSTANT_RECIPES_STORAGE_KEY,
      JSON.stringify([
        { recipe: makeRecipe('old-static'), addedAt: now - 11 * 60 * 1000 },
        { recipe: makeRecipe('fresh-static'), addedAt: now - 2 * 60 * 1000 },
        { recipe: makeRecipe('unbuilt-old'), addedAt: now - 30 * 60 * 1000 },
      ])
    );

    pruneBuiltInstantRecipes(new Set(['old-static', 'fresh-static']));
    const remainingSlugs = getStoredInstantRecipes().map((item) => item.recipe.slug);
    expect(remainingSlugs).toEqual(['fresh-static', 'unbuilt-old']);
  });

  it('prunes deleted markers using 5 min (unbuilt) and 15 min (static) windows', () => {
    const now = Date.now();
    window.localStorage.setItem(
      DELETED_RECIPES_STORAGE_KEY,
      JSON.stringify([
        { slug: 'static-expired', deletedAt: now - 16 * 60 * 1000 },
        { slug: 'static-active', deletedAt: now - 10 * 60 * 1000 },
        { slug: 'dynamic-expired', deletedAt: now - 6 * 60 * 1000 },
        { slug: 'dynamic-active', deletedAt: now - 2 * 60 * 1000 },
      ])
    );

    pruneDeletedRecipes(new Set(['static-expired', 'static-active']));
    const remaining = getStoredDeletedRecipes().map((item) => item.slug);
    expect(remaining).toEqual(['static-active', 'dynamic-active']);
  });

  it('persists tracker jobs and respects emit option', () => {
    const listener = vi.fn();
    window.addEventListener(TRACKER_JOB_CHANGED_EVENT, listener);

    saveTrackerJob(
      {
        id: 'job-2',
        recipeUrl: 'https://example.com',
        stage: 'queued',
        startedAt: 1000,
        baselineRunIds: [1],
        baselineFilenames: ['a.json'],
      },
      { emit: false }
    );
    expect(listener).not.toHaveBeenCalled();
    expect(getStoredTrackerJob()?.id).toBe('job-2');

    saveTrackerJob(null);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getStoredTrackerJob()).toBeNull();

    window.removeEventListener(TRACKER_JOB_CHANGED_EVENT, listener);
  });
});
