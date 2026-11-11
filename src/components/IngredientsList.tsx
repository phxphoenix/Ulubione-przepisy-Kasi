import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Minus,
  Plus,
  RotateCcw,
  ShoppingBasket,
} from 'lucide-react';
import type { IngredientGroup, IngredientItem } from '../types/recipe';
import { formatScaledAmount, formatServingsLabel } from '../utils/recipe';

export interface IngredientsListProps {
  recipeSlug: string;
  recipeTitle: string;
  baseServings: number;
  ingredientGroups: IngredientGroup[];
}

const MULTIPLIERS = [0.5, 1, 2] as const;

function getItemKey(groupIndex: number, itemIndex: number): string {
  return `${groupIndex}:${itemIndex}`;
}

function getStorageKey(slug: string): string {
  return `kasia-cookbook:ingredients:${slug}`;
}

function formatIngredientTextLine(
  item: IngredientItem,
  scaleFactor: number
): string {
  const parts: string[] = [];
  if (item.amount !== null && item.amount !== undefined) {
    parts.push(formatScaledAmount(item.amount, scaleFactor));
  }
  if (item.unit) {
    parts.push(item.unit);
  }
  parts.push(item.name);

  const baseLine = parts.join(' ');
  return item.notes ? `${baseLine} (${item.notes})` : baseLine;
}

export default function IngredientsList({
  recipeSlug,
  recipeTitle,
  baseServings,
  ingredientGroups,
}: IngredientsListProps) {
  const [currentServings, setCurrentServings] = useState(baseServings);
  const [checkedKeys, setCheckedKeys] = useState<Record<string, boolean>>({});
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>(
    'idle'
  );
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setCurrentServings(baseServings);
  }, [recipeSlug, baseServings]);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(getStorageKey(recipeSlug));
      if (!saved) {
        setCheckedKeys({});
        return;
      }
      const parsed: unknown = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        const nextMap: Record<string, boolean> = {};
        for (const key of parsed) {
          if (typeof key === 'string') {
            nextMap[key] = true;
          }
        }
        setCheckedKeys(nextMap);
      } else {
        setCheckedKeys({});
      }
    } catch {
      setCheckedKeys({});
    }
  }, [recipeSlug]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const scaleFactor = baseServings > 0 ? currentServings / baseServings : 1;

  const totalItemsCount = useMemo(
    () =>
      ingredientGroups.reduce((sum, group) => sum + group.items.length, 0),
    [ingredientGroups]
  );

  const checkedCount = useMemo(
    () => Object.values(checkedKeys).filter(Boolean).length,
    [checkedKeys]
  );

  function persistCheckedKeys(nextMap: Record<string, boolean>) {
    try {
      const activeKeys = Object.entries(nextMap)
        .filter(([, isChecked]) => isChecked)
        .map(([key]) => key);
      if (activeKeys.length === 0) {
        window.sessionStorage.removeItem(getStorageKey(recipeSlug));
      } else {
        window.sessionStorage.setItem(
          getStorageKey(recipeSlug),
          JSON.stringify(activeKeys)
        );
      }
    } catch {
      // Ignore storage quota or private browsing errors
    }
  }

  function toggleIngredient(key: string) {
    setCheckedKeys((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (!next[key]) {
        delete next[key];
      }
      persistCheckedKeys(next);
      return next;
    });
  }

  function handleClearChecked() {
    setCheckedKeys({});
    persistCheckedKeys({});
  }

  function handleDecreaseServings() {
    setCurrentServings((prev) =>
      prev <= 1 ? Math.max(0.5, Math.round((prev - 0.5) * 100) / 100) : prev - 1
    );
  }

  function handleIncreaseServings() {
    setCurrentServings((prev) =>
      prev < 1 ? 1 : Math.min(99, Math.round((prev + 1) * 100) / 100)
    );
  }

  function handleMultiplier(multiplier: number) {
    const next = Math.max(0.5, Math.round(baseServings * multiplier * 100) / 100);
    setCurrentServings(next);
  }

  async function handleCopyShoppingList() {
    const lines: string[] = [
      `Lista zakupów: ${recipeTitle} (${formatServingsLabel(currentServings)})`,
    ];

    for (const group of ingredientGroups) {
      lines.push('');
      if (group.groupName) {
        lines.push(`${group.groupName}:`);
      }
      for (const item of group.items) {
        lines.push(`- ${formatIngredientTextLine(item, scaleFactor)}`);
      }
    }

    const text = lines.join('\n');

    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const legacyCopy = Reflect.get(document, 'execCommand') as
          | ((commandId: string) => boolean)
          | undefined;
        const copied =
          typeof legacyCopy === 'function'
            ? legacyCopy.call(document, 'copy')
            : false;
        document.body.removeChild(textarea);
        if (!copied) {
          throw new Error('Copy command failed');
        }
      }
      setCopyStatus('copied');
    } catch {
      setCopyStatus('error');
    }

    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopyStatus('idle');
    }, 2500);
  }

  return (
    <section
      aria-labelledby="ingredients-heading"
      className="rounded-2xl border border-[#EAE5DF] bg-white p-5 shadow-xs sm:p-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#4A6B53]/10 text-[#4A6B53]">
            <ShoppingBasket className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2
              id="ingredients-heading"
              className="font-serif text-xl font-bold text-[#1F2421]"
            >
              Składniki
            </h2>
            {checkedCount > 0 ? (
              <p className="text-xs font-medium text-[#4A6B53]">
                Odhaczono {checkedCount} z {totalItemsCount}
              </p>
            ) : null}
          </div>
        </div>

        {checkedCount > 0 ? (
          <button
            type="button"
            onClick={handleClearChecked}
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-[#C86D51] transition-colors hover:bg-[#C86D51]/10 active:scale-95 touch-manipulation"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Odznacz</span>
          </button>
        ) : null}
      </div>

      {/* Servings stepper & multipliers */}
      <div className="mt-4 rounded-xl border border-[#EAE5DF] bg-[#FAF8F5] p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold tracking-wide text-[#1F2421]/65 uppercase">
            Liczba porcji
          </span>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleDecreaseServings}
              disabled={currentServings <= 0.5}
              aria-label="Zmniejsz liczbę porcji"
              className="flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-xl border border-[#EAE5DF] bg-white text-[#1F2421] shadow-xs transition-all hover:border-[#4A6B53]/40 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 touch-manipulation"
            >
              <Minus className="h-4 w-4" aria-hidden="true" />
            </button>

            <span
              aria-live="polite"
              className="min-w-[5.5rem] px-2 text-center text-sm font-bold text-[#1F2421] tabular-nums"
            >
              {formatServingsLabel(currentServings)}
            </span>

            <button
              type="button"
              onClick={handleIncreaseServings}
              disabled={currentServings >= 99}
              aria-label="Zwiększ liczbę porcji"
              className="flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-xl border border-[#EAE5DF] bg-white text-[#1F2421] shadow-xs transition-all hover:border-[#4A6B53]/40 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 touch-manipulation"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Quick multipliers */}
        <div
          role="group"
          aria-label="Szybkie mnożniki porcji"
          className="mt-2.5 grid grid-cols-3 gap-2"
        >
          {MULTIPLIERS.map((multiplier) => {
            const isActive = Math.abs(scaleFactor - multiplier) < 0.001;
            return (
              <button
                key={multiplier}
                type="button"
                onClick={() => handleMultiplier(multiplier)}
                aria-pressed={isActive}
                className={`min-h-[44px] cursor-pointer rounded-xl border px-3 text-xs font-bold transition-all active:scale-[0.97] touch-manipulation ${
                  isActive
                    ? 'border-[#4A6B53] bg-[#4A6B53] text-white shadow-xs'
                    : 'border-[#EAE5DF] bg-white text-[#1F2421]/75 hover:border-[#4A6B53]/40 hover:text-[#1F2421]'
                }`}
              >
                {multiplier}x
              </button>
            );
          })}
        </div>
      </div>

      {/* Ingredient groups list */}
      <div className="mt-5 space-y-5">
        {ingredientGroups.map((group, groupIndex) => (
          <div key={`${group.groupName ?? 'group'}-${groupIndex}`}>
            {group.groupName ? (
              <h3 className="mb-2 text-xs font-bold tracking-wider text-[#4A6B53] uppercase">
                {group.groupName}
              </h3>
            ) : null}

            <ul className="divide-y divide-[#EAE5DF]/70">
              {group.items.map((item, itemIndex) => {
                const key = getItemKey(groupIndex, itemIndex);
                const isChecked = Boolean(checkedKeys[key]);
                const hasAmount =
                  item.amount !== null && item.amount !== undefined;

                return (
                  <li key={key}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isChecked}
                      onClick={() => toggleIngredient(key)}
                      className="group flex min-h-[48px] w-full cursor-pointer items-start gap-3 py-2.5 text-left transition-opacity active:opacity-80 touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6B53] rounded-lg"
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all ${
                          isChecked
                            ? 'border-[#4A6B53] bg-[#4A6B53] text-white'
                            : 'border-[#CFC8BE] bg-white group-hover:border-[#4A6B53]'
                        }`}
                      >
                        {isChecked ? (
                          <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                        ) : null}
                      </span>

                      <span
                        className={`flex-1 text-sm leading-relaxed transition-all ${
                          isChecked
                            ? 'text-[#1F2421]/45 line-through'
                            : 'text-[#1F2421]'
                        }`}
                      >
                        {hasAmount ? (
                          <strong className="font-bold tabular-nums">
                            {formatScaledAmount(
                              item.amount as number,
                              scaleFactor
                            )}
                            {item.unit ? ` ${item.unit}` : ''}{' '}
                          </strong>
                        ) : item.unit ? (
                          <strong className="font-bold">{item.unit} </strong>
                        ) : null}
                        <span>{item.name}</span>
                        {item.notes ? (
                          <span className="text-[#1F2421]/55">
                            {' '}
                            ({item.notes})
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* Copy shopping list CTA */}
      <div className="mt-6 border-t border-[#EAE5DF] pt-4">
        <button
          type="button"
          onClick={handleCopyShoppingList}
          className={`flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition-all active:scale-[0.98] touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6B53] focus-visible:ring-offset-2 ${
            copyStatus === 'copied'
              ? 'border-[#4A6B53] bg-[#EDF3EE] text-[#3B5542]'
              : copyStatus === 'error'
                ? 'border-[#C86D51] bg-[#FDF0EB] text-[#B35B40]'
                : 'border-[#EAE5DF] bg-[#FAF8F5] text-[#1F2421] hover:border-[#4A6B53]/40 hover:bg-[#EDF3EE]/50'
          }`}
        >
          {copyStatus === 'copied' ? (
            <>
              <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Skopiowano listę zakupów!</span>
            </>
          ) : copyStatus === 'error' ? (
            <>
              <Copy className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Nie udało się skopiować — spróbuj ponownie</span>
            </>
          ) : (
            <>
              <Copy
                className="h-4 w-4 shrink-0 text-[#4A6B53]"
                aria-hidden="true"
              />
              <span>Kopiuj listę zakupów</span>
            </>
          )}
        </button>
      </div>
    </section>
  );
}
