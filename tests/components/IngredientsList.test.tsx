import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import IngredientsList from '../../src/components/IngredientsList';
import type { IngredientGroup } from '../../src/types/recipe';

const SAMPLE_GROUPS: IngredientGroup[] = [
  {
    groupName: 'Baza',
    items: [
      { name: 'Mąka pszenna', amount: 200, unit: 'g', notes: 'przesiana' },
      { name: 'Mleko', amount: 250, unit: 'ml' },
      { name: 'Sól', amount: null, notes: 'szczypta' },
    ],
  },
];

describe('IngredientsList component', () => {
  it('renders ingredients and scales amounts with stepper and multipliers', () => {
    render(
      <IngredientsList
        recipeSlug="nalesniki"
        recipeTitle="Naleśniki"
        baseServings={4}
        ingredientGroups={SAMPLE_GROUPS}
      />
    );

    expect(screen.getByText('4 porcje')).toBeInTheDocument();
    expect(screen.getByText(/200 g/)).toBeInTheDocument();
    expect(screen.getByText(/250 ml/)).toBeInTheDocument();
    expect(screen.getByText('Sól')).toBeInTheDocument();

    // Quick multiplier 2x -> 8 porcji, 400 g mąki
    const doubleBtn = screen.getByRole('button', { name: '2x' });
    fireEvent.click(doubleBtn);
    expect(doubleBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('8 porcji')).toBeInTheDocument();
    expect(screen.getByText(/400 g/)).toBeInTheDocument();
    expect(screen.getByText(/500 ml/)).toBeInTheDocument();

    // Quick multiplier 0.5x -> 2 porcje, 100 g mąki
    fireEvent.click(screen.getByRole('button', { name: '0.5x' }));
    expect(screen.getByText('2 porcje')).toBeInTheDocument();
    expect(screen.getByText(/100 g/)).toBeInTheDocument();

    // Stepper +1 -> 3 porcje
    fireEvent.click(screen.getByRole('button', { name: 'Zwiększ liczbę porcji' }));
    expect(screen.getByText('3 porcje')).toBeInTheDocument();
    expect(screen.getByText(/150 g/)).toBeInTheDocument();
  });

  it('toggles ingredient checkboxes, persists to sessionStorage, and resets checked items', () => {
    render(
      <IngredientsList
        recipeSlug="nalesniki"
        recipeTitle="Naleśniki"
        baseServings={4}
        ingredientGroups={SAMPLE_GROUPS}
      />
    );

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(3);

    fireEvent.click(checkboxes[0]);
    expect(checkboxes[0]).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Odhaczono 1 z 3')).toBeInTheDocument();
    expect(window.sessionStorage.getItem('kasia-cookbook:ingredients:nalesniki')).toBe(
      JSON.stringify(['0:0'])
    );

    fireEvent.click(screen.getByRole('button', { name: 'Odznacz' }));
    expect(checkboxes[0]).toHaveAttribute('aria-checked', 'false');
    expect(window.sessionStorage.getItem('kasia-cookbook:ingredients:nalesniki')).toBeNull();
  });

  it('copies formatted shopping list to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(
      <IngredientsList
        recipeSlug="nalesniki"
        recipeTitle="Naleśniki"
        baseServings={4}
        ingredientGroups={SAMPLE_GROUPS}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Kopiuj listę zakupów' }));

    await waitFor(() => {
      expect(screen.getByText('Skopiowano listę zakupów!')).toBeInTheDocument();
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedText = writeText.mock.calls[0][0] as string;
    expect(copiedText).toContain('Lista zakupów: Naleśniki (4 porcje)');
    expect(copiedText).toContain('Baza:');
    expect(copiedText).toContain('- 200 g Mąka pszenna (przesiana)');
    expect(copiedText).toContain('- Sól (szczypta)');
  });
});
