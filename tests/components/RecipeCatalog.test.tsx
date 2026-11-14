import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RecipeCatalog, { type CatalogRecipe } from '../../src/components/RecipeCatalog';
import { saveInstantRecipe } from '../../src/utils/instantRecipes';

const SAMPLE_RECIPES: CatalogRecipe[] = [
  {
    slug: 'zurek-staropolski',
    title: 'Żurek staropolski',
    summary: 'Tradycyjna zupa na zakwasie żytnim.',
    category: 'Zupy',
    tags: ['wielkanoc', 'tradycyjna'],
    totalTimeMinutes: 60,
    difficulty: 'Średni',
    images: [{ url: 'https://example.com/zurek.jpg', isMain: true }],
    ingredientNames: ['Zakwas żytni', 'Biała kiełbasa', 'Majeranek'],
    sourceDomain: 'kwestiasmaku.com',
    createdAt: '2026-11-10T10:00:00.000Z',
  },
  {
    slug: 'jajecznica-z-kurkami',
    title: 'Jajecznica z kurkami',
    summary: 'Szybkie letnie śniadanie na maśle.',
    category: 'Śniadania',
    tags: ['szybkie', 'grzyby'],
    totalTimeMinutes: 15,
    difficulty: 'Łatwy',
    images: [{ url: 'https://example.com/jajecznica.jpg', isMain: true }],
    ingredientNames: ['Jajka', 'Kurki', 'Masło'],
    sourceDomain: 'example.com',
    createdAt: '2026-11-12T08:00:00.000Z',
  },
  {
    slug: 'tarta-cytrynowa',
    title: 'Tarta cytrynowa z bezą',
    summary: 'Kruchy spód i kwaśny krem cytrynowy.',
    category: 'Desery i wypieki',
    tags: ['ciasto', 'cytryna'],
    totalTimeMinutes: 90,
    difficulty: 'Wymagający',
    images: [{ url: 'https://example.com/tarta.jpg', isMain: true }],
    ingredientNames: ['Cytryny', 'Mąka', 'Cukier'],
    sourceDomain: 'example.com',
    createdAt: '2026-11-11T12:00:00.000Z',
  },
];

describe('RecipeCatalog component', () => {
  it('filters by Polish diacritics-insensitive search across title, tags, and ingredients', () => {
    render(<RecipeCatalog recipes={SAMPLE_RECIPES} />);

    const searchInput = screen.getByLabelText(
      'Szukaj przepisów po tytule, tagach lub składnikach'
    );

    // Search "zurek" without Polish diacritic "ż"
    fireEvent.change(searchInput, { target: { value: 'zurek' } });
    expect(screen.getByText('Żurek staropolski')).toBeInTheDocument();
    expect(screen.queryByText('Jajecznica z kurkami')).not.toBeInTheDocument();

    // Search by ingredient without diacritics ("biala kielbasa")
    fireEvent.change(searchInput, { target: { value: 'biala kielbasa' } });
    expect(screen.getByText('Żurek staropolski')).toBeInTheDocument();

    // Empty state & reset filters
    fireEvent.change(searchInput, { target: { value: 'nieistniejacy-skladnik' } });
    expect(screen.getByText('Nie znaleziono pasujących przepisów')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Resetuj filtry' }));
    expect(screen.getByText('Jajecznica z kurkami')).toBeInTheDocument();
    expect(screen.getByText('Tarta cytrynowa z bezą')).toBeInTheDocument();
  });

  it('filters by category pills and sorts by fastest and alphabetical', () => {
    render(<RecipeCatalog recipes={SAMPLE_RECIPES} />);

    const deseryBtn = screen.getByRole('button', { name: /Desery i wypieki/ });
    fireEvent.click(deseryBtn);
    expect(deseryBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Tarta cytrynowa z bezą')).toBeInTheDocument();
    expect(screen.queryByText('Żurek staropolski')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Wszystkie/ }));

    const sortSelect = screen.getByLabelText('Sortuj przepisy');
    fireEvent.change(sortSelect, { target: { value: 'fastest' } });
    const titlesFastest = screen
      .getAllByRole('heading', { level: 3 })
      .map((el) => el.textContent);
    expect(titlesFastest).toEqual([
      'Jajecznica z kurkami',
      'Żurek staropolski',
      'Tarta cytrynowa z bezą',
    ]);

    fireEvent.change(sortSelect, { target: { value: 'alphabetical' } });
    const titlesAlpha = screen
      .getAllByRole('heading', { level: 3 })
      .map((el) => el.textContent);
    expect(titlesAlpha).toEqual([
      'Jajecznica z kurkami',
      'Tarta cytrynowa z bezą',
      'Żurek staropolski',
    ]);
  });

  it('merges instant recipes from localStorage with "Nowość" badge', () => {
    saveInstantRecipe({
      id: 'nowy-koktajl',
      slug: 'nowy-koktajl',
      title: 'Koktajl mango lassi',
      summary: 'Orzeźwiający napój jogurtowy.',
      category: 'Napoje i dodatki',
      tags: ['mango'],
      totalTimeMinutes: 5,
      servings: 2,
      difficulty: 'Łatwy',
      images: [{ url: 'https://example.com/mango.jpg', isMain: true }],
      videos: [],
      ingredientGroups: [{ items: [{ name: 'Mango', amount: 1, unit: 'szt.' }] }],
      steps: [{ stepNumber: 1, instruction: 'Zblenduj składniki.' }],
      chefTips: [],
      sourceUrl: 'https://example.com/mango',
      sourceDomain: 'example.com',
      originalLanguage: 'pl',
      createdAt: '2026-11-14T10:00:00.000Z',
    });

    render(<RecipeCatalog recipes={SAMPLE_RECIPES} />);
    expect(screen.getByText('Koktajl mango lassi')).toBeInTheDocument();
    expect(screen.getByText('Nowość – właśnie dodano!')).toBeInTheDocument();
  });
});
