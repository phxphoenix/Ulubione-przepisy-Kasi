import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { recipeSchema } from './schemas/recipe';

export * from './schemas/recipe';

const recipes = defineCollection({
  loader: glob({
    pattern: '**/*.json',
    base: './src/content/recipes',
    generateId: ({ entry, data }) => {
      if (typeof data.slug === 'string' && data.slug.trim().length > 0) {
        return data.slug.trim();
      }
      if (typeof data.id === 'string' && data.id.trim().length > 0) {
        return data.id.trim();
      }
      return entry.replace(/\.json$/i, '');
    },
  }),
  schema: recipeSchema,
});

export const collections = { recipes };
