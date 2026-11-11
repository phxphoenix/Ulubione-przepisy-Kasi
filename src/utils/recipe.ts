import type { RecipeDifficulty, RecipeImage } from '../types/recipe';

export const DIFFICULTY_BADGE_CLASSES: Record<RecipeDifficulty, string> = {
  Łatwy: 'bg-[#EDF3EE] text-[#3B5542] border-[#C9DBC9]',
  Średni: 'bg-[#FDF4E3] text-[#945B17] border-[#EED9B7]',
  Wymagający: 'bg-[#FCF0F2] text-[#A24156] border-[#F2CED6]',
};

export function formatTotalTime(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0
    ? `${hours} godz.`
    : `${hours} godz. ${remainingMinutes} min`;
}

export function formatRecipeCount(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (count === 1) {
    return '1 przepis';
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} przepisy`;
  }
  return `${count} przepisów`;
}

export function formatServingsLabel(servings: number): string {
  const rounded = Math.round(servings * 100) / 100;
  const formatted = rounded.toLocaleString('pl-PL', {
    maximumFractionDigits: 2,
    useGrouping: false,
  });

  if (!Number.isInteger(rounded)) {
    return `${formatted} porcji`;
  }

  const mod10 = rounded % 10;
  const mod100 = rounded % 100;
  if (rounded === 1) {
    return '1 porcja';
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${formatted} porcje`;
  }
  return `${formatted} porcji`;
}

export function formatScaledAmount(amount: number, scaleFactor: number): string {
  const raw = amount * scaleFactor;
  if (raw <= 0) {
    return '0';
  }

  let rounded: number;
  if (raw >= 100) {
    rounded = Math.round(raw);
  } else if (raw >= 10) {
    rounded = Math.round(raw * 10) / 10;
  } else {
    rounded = Math.round(raw * 100) / 100;
  }

  return rounded.toLocaleString('pl-PL', {
    maximumFractionDigits: 2,
    useGrouping: false,
  });
}

export function orderImagesWithMainFirst(
  images: readonly RecipeImage[]
): RecipeImage[] {
  if (images.length <= 1) {
    return [...images];
  }
  const mainIndex = images.findIndex((img) => img.isMain);
  if (mainIndex <= 0) {
    return [...images];
  }
  const main = images[mainIndex];
  return [main, ...images.slice(0, mainIndex), ...images.slice(mainIndex + 1)];
}
