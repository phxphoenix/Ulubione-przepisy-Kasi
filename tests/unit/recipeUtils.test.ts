import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  CATEGORY_MAP,
  CATEGORY_NAMES,
  getCategoryMeta,
} from '../../src/constants/categories';
import {
  formatRecipeCount,
  formatScaledAmount,
  formatServingsLabel,
  formatTotalTime,
  orderImagesWithMainFirst,
} from '../../src/utils/recipe';

describe('recipe utilities', () => {
  describe('formatTotalTime', () => {
    it('formats minutes under an hour', () => {
      expect(formatTotalTime(5)).toBe('5 min');
      expect(formatTotalTime(45)).toBe('45 min');
    });

    it('formats exact hours without remaining minutes', () => {
      expect(formatTotalTime(60)).toBe('1 godz.');
      expect(formatTotalTime(120)).toBe('2 godz.');
    });

    it('formats hours and remaining minutes', () => {
      expect(formatTotalTime(75)).toBe('1 godz. 15 min');
      expect(formatTotalTime(150)).toBe('2 godz. 30 min');
    });
  });

  describe('formatRecipeCount', () => {
    it('uses correct Polish pluralization rules', () => {
      expect(formatRecipeCount(0)).toBe('0 przepisów');
      expect(formatRecipeCount(1)).toBe('1 przepis');
      expect(formatRecipeCount(2)).toBe('2 przepisy');
      expect(formatRecipeCount(4)).toBe('4 przepisy');
      expect(formatRecipeCount(5)).toBe('5 przepisów');
      expect(formatRecipeCount(11)).toBe('11 przepisów');
      expect(formatRecipeCount(12)).toBe('12 przepisów');
      expect(formatRecipeCount(14)).toBe('14 przepisów');
      expect(formatRecipeCount(21)).toBe('21 przepisów');
      expect(formatRecipeCount(22)).toBe('22 przepisy');
      expect(formatRecipeCount(104)).toBe('104 przepisy');
      expect(formatRecipeCount(113)).toBe('113 przepisów');
    });
  });

  describe('formatServingsLabel', () => {
    it('formats integer servings with Polish grammar', () => {
      expect(formatServingsLabel(1)).toBe('1 porcja');
      expect(formatServingsLabel(2)).toBe('2 porcje');
      expect(formatServingsLabel(4)).toBe('4 porcje');
      expect(formatServingsLabel(5)).toBe('5 porcji');
      expect(formatServingsLabel(12)).toBe('12 porcji');
      expect(formatServingsLabel(23)).toBe('23 porcje');
    });

    it('formats fractional servings with Polish decimal separator', () => {
      expect(formatServingsLabel(0.5)).toBe('0,5 porcji');
      expect(formatServingsLabel(1.5)).toBe('1,5 porcji');
      expect(formatServingsLabel(2.25)).toBe('2,25 porcji');
    });
  });

  describe('formatScaledAmount', () => {
    it('scales and rounds amounts according to magnitude', () => {
      expect(formatScaledAmount(0, 2)).toBe('0');
      expect(formatScaledAmount(250, 2)).toBe('500');
      expect(formatScaledAmount(125, 0.5)).toBe('62,5');
      expect(formatScaledAmount(15, 0.5)).toBe('7,5');
      expect(formatScaledAmount(1, 0.333)).toBe('0,33');
      expect(formatScaledAmount(2, 1.5)).toBe('3');
    });
  });

  describe('orderImagesWithMainFirst', () => {
    it('returns copy as-is for empty, single, or already-first main image', () => {
      expect(orderImagesWithMainFirst([])).toEqual([]);

      const single = [{ url: '/a.jpg', isMain: true }];
      expect(orderImagesWithMainFirst(single)).toEqual(single);

      const alreadyFirst = [
        { url: '/a.jpg', isMain: true },
        { url: '/b.jpg', isMain: false },
      ];
      expect(orderImagesWithMainFirst(alreadyFirst)).toEqual(alreadyFirst);
    });

    it('moves the main image to index 0 while preserving order of others', () => {
      const images = [
        { url: '/step1.jpg', isMain: false },
        { url: '/main.jpg', isMain: true },
        { url: '/step2.jpg', isMain: false },
      ];
      expect(orderImagesWithMainFirst(images)).toEqual([
        { url: '/main.jpg', isMain: true },
        { url: '/step1.jpg', isMain: false },
        { url: '/step2.jpg', isMain: false },
      ]);
    });
  });

  describe('categories metadata', () => {
    it('exposes consistent metadata for every allowed category', () => {
      expect(CATEGORIES).toHaveLength(CATEGORY_NAMES.length);
      for (const name of CATEGORY_NAMES) {
        const meta = getCategoryMeta(name);
        expect(meta).toBeDefined();
        expect(meta).toBe(CATEGORY_MAP[name]);
        expect(meta.slug).toMatch(/^[a-z0-9-]+$/);
      }
    });
  });
});
