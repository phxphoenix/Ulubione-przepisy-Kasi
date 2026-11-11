import type { z } from 'astro/zod';
import type {
  recipeSchema,
  recipeImageSchema,
  recipeVideoSchema,
  ingredientItemSchema,
  ingredientGroupSchema,
  recipeStepSchema,
  DIFFICULTY_LEVELS,
  VIDEO_PLATFORMS,
} from '../schemas/recipe';

export type RecipeDifficulty = (typeof DIFFICULTY_LEVELS)[number];
export type VideoPlatform = (typeof VIDEO_PLATFORMS)[number];
export type RecipeImage = z.infer<typeof recipeImageSchema>;
export type RecipeVideo = z.infer<typeof recipeVideoSchema>;
export type IngredientItem = z.infer<typeof ingredientItemSchema>;
export type IngredientGroup = z.infer<typeof ingredientGroupSchema>;
export type RecipeStep = z.infer<typeof recipeStepSchema>;
export type Recipe = z.infer<typeof recipeSchema>;
