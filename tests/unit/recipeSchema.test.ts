import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { recipeSchema } from '../../src/schemas/recipe';

const RECIPES_DIR = path.resolve(process.cwd(), 'src/content/recipes');
const PUBLIC_DIR = path.resolve(process.cwd(), 'public');

function createValidRecipePayload() {
  return {
    id: 'zupa-pomidorowa',
    slug: 'zupa-pomidorowa',
    title: 'Domowa zupa pomidorowa',
    summary: 'Klasyczna zupa pomidorowa na bulionie warzywnym.',
    category: 'Zupy',
    tags: ['zupa', 'pomidory', 'klasyk'],
    prepTimeMinutes: 10,
    cookTimeMinutes: 30,
    totalTimeMinutes: 40,
    servings: 4,
    difficulty: 'Łatwy',
    images: [{ url: 'https://example.com/zupa.jpg', caption: 'Zupa', isMain: true }],
    videos: [],
    ingredientGroups: [
      {
        groupName: 'Baza',
        items: [{ name: 'Passata pomidorowa', amount: 500, unit: 'ml' }],
      },
    ],
    steps: [{ stepNumber: 1, title: 'Gotowanie', instruction: 'Zagotuj bulion z passatą.' }],
    chefTips: ['Podaj z bazylią.'],
    sourceUrl: 'https://example.com/zupa-pomidorowa',
    sourceDomain: 'example.com',
    originalLanguage: 'pl',
    createdAt: '2026-11-12T18:00:00.000Z',
  };
}

describe('recipeSchema & repository recipe content integrity', () => {
  it('accepts a valid recipe payload', () => {
    const parsed = recipeSchema.safeParse(createValidRecipePayload());
    expect(parsed.success).toBe(true);
  });

  it('rejects invalid category, difficulty, empty images, invalid URL, or invalid date', () => {
    expect(
      recipeSchema.safeParse({ ...createValidRecipePayload(), category: 'Nieznana' }).success
    ).toBe(false);
    expect(
      recipeSchema.safeParse({ ...createValidRecipePayload(), difficulty: 'Ekstremalny' }).success
    ).toBe(false);
    expect(
      recipeSchema.safeParse({ ...createValidRecipePayload(), images: [] }).success
    ).toBe(false);
    expect(
      recipeSchema.safeParse({ ...createValidRecipePayload(), sourceUrl: 'not-a-url' }).success
    ).toBe(false);
    expect(
      recipeSchema.safeParse({ ...createValidRecipePayload(), createdAt: 'not-a-date' }).success
    ).toBe(false);
    expect(
      recipeSchema.safeParse({ ...createValidRecipePayload(), totalTimeMinutes: 0 }).success
    ).toBe(false);
  });

  it('validates all committed recipe JSON files in src/content/recipes/', () => {
    const files = fs
      .readdirSync(RECIPES_DIR)
      .filter((name) => name.toLowerCase().endsWith('.json'));

    expect(files.length).toBeGreaterThan(0);

    const seenSlugs = new Set<string>();

    for (const file of files) {
      const fullPath = path.join(RECIPES_DIR, file);
      const raw = JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as unknown;
      const result = recipeSchema.safeParse(raw);

      expect(
        result.success,
        `Błąd walidacji schematu w pliku ${file}: ${result.success ? '' : JSON.stringify(result.error.issues)}`
      ).toBe(true);

      if (result.success) {
        const recipe = result.data;
        expect(seenSlugs.has(recipe.slug), `Zduplikowany slug: ${recipe.slug}`).toBe(false);
        seenSlugs.add(recipe.slug);

        for (const image of recipe.images) {
          if (image.url.startsWith('/')) {
            const localAsset = path.join(PUBLIC_DIR, image.url.slice(1));
            expect(
              fs.existsSync(localAsset),
              `Brak lokalnego pliku zdjęcia ${image.url} użytego w ${file}`
            ).toBe(true);
          }
        }

        for (const step of recipe.steps) {
          if (step.imageUrl && step.imageUrl.startsWith('/')) {
            const localAsset = path.join(PUBLIC_DIR, step.imageUrl.slice(1));
            expect(
              fs.existsSync(localAsset),
              `Brak lokalnego zdjęcia kroku ${step.imageUrl} użytego w ${file}`
            ).toBe(true);
          }
        }
      }
    }
  });
});
