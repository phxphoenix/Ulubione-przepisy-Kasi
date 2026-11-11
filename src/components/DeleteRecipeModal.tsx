import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import {
  AlertCircle,
  Clock,
  KeyRound,
  Loader2,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import { getCategoryMeta, type RecipeCategory } from '../constants/categories';
import {
  getGitHubToken,
  TOKEN_CHANGED_EVENT,
} from '../utils/githubClient';
import { withBase } from '../utils/paths';
import { formatTotalTime } from '../utils/recipe';

export interface DeleteRecipePreview {
  slug: string;
  title: string;
  category: RecipeCategory;
  totalTimeMinutes: number;
  imageUrl?: string;
  imageCaption?: string;
}

export interface DeleteRecipeModalProps {
  recipe: DeleteRecipePreview | null;
  isDeleting: boolean;
  error: { message: string; code?: string } | null;
  onCancel: () => void;
  onConfirm: (recipe: DeleteRecipePreview) => void;
  onOpenSettings: () => void;
}

export default function DeleteRecipeModal({
  recipe,
  isDeleting,
  error,
  onCancel,
  onConfirm,
  onOpenSettings,
}: DeleteRecipeModalProps) {
  const [hasToken, setHasToken] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    function syncToken() {
      setHasToken(Boolean(getGitHubToken()));
    }

    syncToken();
    window.addEventListener(TOKEN_CHANGED_EVENT, syncToken);
    return () => {
      window.removeEventListener(TOKEN_CHANGED_EVENT, syncToken);
    };
  }, [recipe]);

  useEffect(() => {
    setThumbFailed(false);
  }, [recipe?.slug, recipe?.imageUrl]);

  // Body scroll lock, Escape handling, and initial focus on Cancel for safety
  useEffect(() => {
    if (!recipe) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTimer = window.setTimeout(() => {
      cancelBtnRef.current?.focus({ preventScroll: true });
    }, 50);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isDeleting) {
        onCancel();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [recipe, isDeleting, onCancel]);

  if (!recipe) {
    return null;
  }

  const categoryMeta = getCategoryMeta(recipe.category);
  const CategoryIcon = categoryMeta.icon;
  const resolvedThumb = recipe.imageUrl ? withBase(recipe.imageUrl) : '';

  const isAuthError =
    error?.code === 'NO_TOKEN' ||
    error?.code === 'UNAUTHORIZED' ||
    error?.code === 'FORBIDDEN';

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && !isDeleting) {
      onCancel();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-recipe-modal-title"
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#1F2421]/50 p-0 backdrop-blur-xs transition-opacity sm:items-center sm:p-4"
    >
      <div className="catalog-item-enter relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-[#EAE5DF] bg-[#FAF8F5] shadow-2xl sm:max-w-md sm:rounded-3xl">
        {/* Mobile sheet grab handle */}
        <div
          aria-hidden="true"
          className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-[#1F2421]/15 sm:hidden"
        />

        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[#EAE5DF] bg-[#FAF8F5]/95 px-5 pt-4 pb-3.5 sm:px-6 sm:pt-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#F2CED6] bg-[#FCF0F2] text-[#A24156]">
              <Trash2 className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="delete-recipe-modal-title"
                className="font-serif text-lg font-bold leading-snug text-[#1F2421] sm:text-xl"
              >
                Usunąć przepis?
              </h2>
              <p className="text-xs text-[#1F2421]/60">
                Usunięcie z książki kucharskiej
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            aria-label="Zamknij okno"
            className="flex min-h-[44px] min-w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-xl border border-[#EAE5DF] bg-white text-[#1F2421]/65 transition-all hover:bg-[#F3EEE7] hover:text-[#1F2421] active:scale-95 disabled:opacity-50 touch-manipulation"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:px-6 sm:pb-6">
          {/* Recipe preview */}
          <div className="flex items-center gap-3.5 rounded-2xl border border-[#EAE5DF] bg-white p-3 shadow-2xs">
            {resolvedThumb && !thumbFailed ? (
              <img
                src={resolvedThumb}
                alt={recipe.imageCaption || recipe.title}
                onError={() => setThumbFailed(true)}
                className="h-16 w-16 shrink-0 rounded-xl object-cover bg-[#F3EEE7]"
              />
            ) : (
              <div
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-[#EAE5DF] bg-[#FAF8F5]"
                style={{ color: categoryMeta.accentColor }}
              >
                <CategoryIcon className="h-6 w-6" aria-hidden="true" />
              </div>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${categoryMeta.badgeClass}`}
                >
                  <CategoryIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>{recipe.category}</span>
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#1F2421]/60">
                  <Clock className="h-3 w-3 text-[#4A6B53]" aria-hidden="true" />
                  <span>{formatTotalTime(recipe.totalTimeMinutes)}</span>
                </span>
              </div>
              <p className="mt-1.5 font-serif text-base font-bold leading-snug text-[#1F2421] line-clamp-2">
                {recipe.title}
              </p>
            </div>
          </div>

          <p className="text-sm leading-relaxed text-[#1F2421]/75">
            Czy na pewno chcesz usunąć ten przepis? Zniknie on z kolekcji
            natychmiast, a jego plik zostanie trwale usunięty z repozytorium
            GitHub.
          </p>

          {!hasToken ? (
            <div className="rounded-2xl border border-[#EED9B7] bg-[#FDF4E3] p-3.5 text-xs leading-relaxed text-[#6E4412]">
              <div className="flex items-start gap-2.5">
                <KeyRound
                  className="mt-0.5 h-4 w-4 shrink-0 text-[#945B17]"
                  aria-hidden="true"
                />
                <div className="flex-1 space-y-2">
                  <p>
                    To urządzenie nie ma jeszcze zapisanego tokenu GitHub
                    potrzebnego do usunięcia przepisu z repozytorium.
                  </p>
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg bg-[#945B17] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#7A4A12] active:scale-95 touch-manipulation"
                  >
                    <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Wklej token lub wygeneruj Magic Link</span>
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {error ? (
            <div
              role="alert"
              className="rounded-2xl border border-[#F2CED6] bg-[#FCF0F2] p-3.5 text-xs leading-relaxed text-[#A24156]"
            >
              <div className="flex items-start gap-2.5">
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
                <div className="flex-1 space-y-2">
                  <p className="font-medium">{error.message}</p>
                  {isAuthError ? (
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg bg-[#A24156] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#893547] active:scale-95 touch-manipulation"
                    >
                      <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Otwórz ustawienia tokenu</span>
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {/* Actions */}
          <div className="flex flex-col-reverse gap-2.5 pt-1 sm:flex-row sm:justify-end">
            <button
              ref={cancelBtnRef}
              type="button"
              onClick={onCancel}
              disabled={isDeleting}
              className="inline-flex min-h-[48px] w-full cursor-pointer items-center justify-center rounded-xl border border-[#EAE5DF] bg-white px-5 py-2.5 text-sm font-semibold text-[#1F2421] shadow-2xs transition-all hover:bg-[#F3EEE7] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto touch-manipulation"
            >
              Anuluj
            </button>

            <button
              type="button"
              onClick={() => onConfirm(recipe)}
              disabled={isDeleting || !hasToken}
              className="inline-flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#A24156] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#893547] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A24156] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAF8F5] sm:w-auto touch-manipulation"
            >
              {isDeleting ? (
                <>
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                  <span>Usuwanie przepisu...</span>
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  <span>Usuń przepis</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
