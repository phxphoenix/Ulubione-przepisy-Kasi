import type { LucideIcon } from 'lucide-react';
import {
  Croissant,
  Soup,
  UtensilsCrossed,
  Salad,
  CakeSlice,
  CupSoda,
} from 'lucide-react';

export const CATEGORY_NAMES = [
  'Śniadania',
  'Zupy',
  'Dania główne',
  'Sałatki i przekąski',
  'Desery i wypieki',
  'Napoje i dodatki',
] as const;

export type RecipeCategory = (typeof CATEGORY_NAMES)[number];

export interface CategoryMeta {
  name: RecipeCategory;
  slug: string;
  description: string;
  iconName: 'Croissant' | 'Soup' | 'UtensilsCrossed' | 'Salad' | 'CakeSlice' | 'CupSoda';
  icon: LucideIcon;
  badgeClass: string;
  activeButtonClass: string;
  accentColor: string;
}

export const CATEGORIES: readonly CategoryMeta[] = [
  {
    name: 'Śniadania',
    slug: 'sniadania',
    description: 'Pożywne poranki na słodko i wytrawnie',
    iconName: 'Croissant',
    icon: Croissant,
    badgeClass: 'bg-[#FDF4E3] text-[#945B17] border border-[#EED9B7]',
    activeButtonClass: 'bg-[#945B17] text-white border-[#945B17]',
    accentColor: '#945B17',
  },
  {
    name: 'Zupy',
    slug: 'zupy',
    description: 'Rozgrzewające kremy, buliony i klasyczne zupy',
    iconName: 'Soup',
    icon: Soup,
    badgeClass: 'bg-[#FDF0EB] text-[#B35B40] border border-[#F0CFC4]',
    activeButtonClass: 'bg-[#C86D51] text-white border-[#C86D51]',
    accentColor: '#C86D51',
  },
  {
    name: 'Dania główne',
    slug: 'dania-glowne',
    description: 'Obiady i sycące kolacje na co dzień i od święta',
    iconName: 'UtensilsCrossed',
    icon: UtensilsCrossed,
    badgeClass: 'bg-[#EDF3EE] text-[#3B5542] border border-[#C9DBC9]',
    activeButtonClass: 'bg-[#4A6B53] text-white border-[#4A6B53]',
    accentColor: '#4A6B53',
  },
  {
    name: 'Sałatki i przekąski',
    slug: 'salatki-i-przekaski',
    description: 'Świeże sałatki, pasty i małe co nieco na stół',
    iconName: 'Salad',
    icon: Salad,
    badgeClass: 'bg-[#EEF6F2] text-[#2B6E52] border border-[#C6E2D5]',
    activeButtonClass: 'bg-[#2B6E52] text-white border-[#2B6E52]',
    accentColor: '#2B6E52',
  },
  {
    name: 'Desery i wypieki',
    slug: 'desery-i-wypieki',
    description: 'Domowe ciasta, ciasteczka i słodkie chwile',
    iconName: 'CakeSlice',
    icon: CakeSlice,
    badgeClass: 'bg-[#FCF0F2] text-[#A24156] border border-[#F2CED6]',
    activeButtonClass: 'bg-[#A24156] text-white border-[#A24156]',
    accentColor: '#A24156',
  },
  {
    name: 'Napoje i dodatki',
    slug: 'napoje-i-dodatki',
    description: 'Koktajle, rozgrzewające napary, sosy i marynaty',
    iconName: 'CupSoda',
    icon: CupSoda,
    badgeClass: 'bg-[#F2F1EE] text-[#4E534F] border border-[#DBD8D0]',
    activeButtonClass: 'bg-[#4E534F] text-white border-[#4E534F]',
    accentColor: '#4E534F',
  },
] as const;

export const CATEGORY_MAP: Record<RecipeCategory, CategoryMeta> = CATEGORIES.reduce(
  (acc, category) => {
    acc[category.name] = category;
    return acc;
  },
  {} as Record<RecipeCategory, CategoryMeta>
);

export function getCategoryMeta(category: RecipeCategory): CategoryMeta {
  return CATEGORY_MAP[category];
}
