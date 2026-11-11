import { z } from 'astro/zod';
import { CATEGORY_NAMES } from '../constants/categories';

export const DIFFICULTY_LEVELS = ['Łatwy', 'Średni', 'Wymagający'] as const;
export const VIDEO_PLATFORMS = ['youtube', 'instagram', 'tiktok', 'mp4'] as const;

export const recipeImageSchema = z.object({
  url: z.string().min(1),
  caption: z.string().optional(),
  isMain: z.boolean().optional(),
});

export const recipeVideoSchema = z.object({
  url: z.string().min(1),
  platform: z.enum(VIDEO_PLATFORMS),
  embedUrl: z.string().min(1),
  title: z.string().optional(),
});

export const ingredientItemSchema = z.object({
  name: z.string().min(1),
  amount: z.number().nonnegative().nullable().optional(),
  unit: z.string().optional(),
  notes: z.string().optional(),
});

export const ingredientGroupSchema = z.object({
  groupName: z.string().optional(),
  items: z.array(ingredientItemSchema).min(1),
});

export const recipeStepSchema = z.object({
  stepNumber: z.number().int().positive(),
  title: z.string().optional(),
  instruction: z.string().min(1),
  tip: z.string().optional(),
  imageUrl: z.string().min(1).optional(),
});

export const recipeSchema = z.object({
  id: z.string().min(1).optional(),
  slug: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  category: z.enum(CATEGORY_NAMES),
  tags: z.array(z.string().min(1)).default([]),
  prepTimeMinutes: z.number().int().nonnegative().optional(),
  cookTimeMinutes: z.number().int().nonnegative().optional(),
  totalTimeMinutes: z.number().int().positive(),
  servings: z.number().positive(),
  difficulty: z.enum(DIFFICULTY_LEVELS),
  images: z.array(recipeImageSchema).min(1, 'Przepis wymaga co najmniej jednego zdjęcia'),
  videos: z.array(recipeVideoSchema).default([]),
  ingredientGroups: z.array(ingredientGroupSchema).min(1),
  steps: z.array(recipeStepSchema).min(1),
  chefTips: z.array(z.string().min(1)).default([]),
  sourceUrl: z.string().url(),
  sourceDomain: z.string().min(1),
  originalLanguage: z.string().min(2),
  createdAt: z.string().refine((val) => !Number.isNaN(Date.parse(val)), {
    message: 'Data utworzenia (createdAt) musi być poprawnym ciągiem ISO',
  }),
});
