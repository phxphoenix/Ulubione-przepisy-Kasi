import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Sparkles, X } from 'lucide-react';
import type { Recipe } from '../types/recipe';
import { consumeMagicLinkFromUrl } from '../utils/githubClient';
import {
  OPEN_ADD_RECIPE_EVENT,
  OPEN_INSTANT_RECIPE_EVENT,
  RECIPE_DELETED_EVENT,
  type OpenAddRecipeDetail,
} from '../utils/instantRecipes';
import { withBase } from '../utils/paths';
import AddRecipeModal from './AddRecipeModal';
import RecipeDetailView from './RecipeDetailView';
import RecipeGenerationTracker from './RecipeGenerationTracker';

export interface RecipeWorkflowControllerProps {
  staticSlugs?: string[];
}

declare global {
  interface Window {
    __kasiaPendingOpenModal?: boolean;
  }
}

export default function RecipeWorkflowController({
  staticSlugs = [],
}: RecipeWorkflowControllerProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInitialView, setModalInitialView] = useState<'form' | 'settings'>(
    'form'
  );
  const [modalPrefillUrl, setModalPrefillUrl] = useState('');
  const [pairingNotice, setPairingNotice] = useState<string | null>(null);
  const [activeInstantRecipe, setActiveInstantRecipe] =
    useState<Recipe | null>(null);
  const [isHomePage, setIsHomePage] = useState(true);

  const pushedPreviewHistoryRef = useRef(false);
  const activeInstantRecipeSlugRef = useRef<string | null>(null);
  const originalTitleRef = useRef<string>('');
  const pairingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    activeInstantRecipeSlugRef.current = activeInstantRecipe?.slug ?? null;
  }, [activeInstantRecipe]);

  const openModal = useCallback((detail?: OpenAddRecipeDetail) => {
    if (typeof window !== 'undefined') {
      window.__kasiaPendingOpenModal = false;
    }
    setModalInitialView(detail?.initialView ?? 'form');
    setModalPrefillUrl(detail?.prefillUrl ?? '');
    setIsModalOpen(true);
  }, []);

  const openInstantPreview = useCallback((recipe: Recipe) => {
    setActiveInstantRecipe((prev) => {
      if (!prev && typeof window !== 'undefined') {
        const previewHash = `#podglad-${encodeURIComponent(recipe.slug)}`;
        window.history.pushState(
          { kasiaInstantSlug: recipe.slug },
          '',
          `${window.location.pathname}${window.location.search}${previewHash}`
        );
        pushedPreviewHistoryRef.current = true;
      }
      return recipe;
    });

    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const closeInstantPreview = useCallback(() => {
    if (typeof window !== 'undefined' && pushedPreviewHistoryRef.current) {
      pushedPreviewHistoryRef.current = false;
      window.history.back();
      return;
    }
    setActiveInstantRecipe(null);
  }, []);

  // Magic Link detection on app startup + event listeners
  useEffect(() => {
    originalTitleRef.current = document.title;

    const homePath = withBase('/');
    const currentPath = window.location.pathname;
    setIsHomePage(
      currentPath === homePath || `${currentPath}/` === homePath
    );

    const magicResult = consumeMagicLinkFromUrl();
    if (magicResult.paired) {
      setPairingNotice('Urządzenie zostało sparowane z książką kucharską!');
      pairingTimerRef.current = window.setTimeout(() => {
        setPairingNotice(null);
      }, 7000);
    }

    // Handle clicks on the static header button that occurred before React hydrated
    if (window.__kasiaPendingOpenModal) {
      window.__kasiaPendingOpenModal = false;
      openModal();
    }

    function handleOpenModalEvent(event: Event) {
      const custom = event as CustomEvent<OpenAddRecipeDetail | undefined>;
      openModal(custom.detail);
    }

    function handleOpenInstantEvent(event: Event) {
      const custom = event as CustomEvent<Recipe | undefined>;
      if (custom.detail) {
        openInstantPreview(custom.detail);
      }
    }

    function handlePopState() {
      if (!window.location.hash.startsWith('#podglad-')) {
        pushedPreviewHistoryRef.current = false;
        setActiveInstantRecipe(null);
      }
    }

    function handleRecipeDeleted(event: Event) {
      const custom = event as CustomEvent<{ slug?: string } | undefined>;
      const deletedSlug = custom.detail?.slug;
      if (deletedSlug && activeInstantRecipeSlugRef.current === deletedSlug) {
        closeInstantPreview();
      }
    }

    window.addEventListener(OPEN_ADD_RECIPE_EVENT, handleOpenModalEvent);
    window.addEventListener(OPEN_INSTANT_RECIPE_EVENT, handleOpenInstantEvent);
    window.addEventListener(RECIPE_DELETED_EVENT, handleRecipeDeleted);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener(OPEN_ADD_RECIPE_EVENT, handleOpenModalEvent);
      window.removeEventListener(
        OPEN_INSTANT_RECIPE_EVENT,
        handleOpenInstantEvent
      );
      window.removeEventListener(RECIPE_DELETED_EVENT, handleRecipeDeleted);
      window.removeEventListener('popstate', handlePopState);
      if (pairingTimerRef.current !== null) {
        window.clearTimeout(pairingTimerRef.current);
      }
    };
  }, [closeInstantPreview, openInstantPreview, openModal]);

  // Hide static Astro slot content and update page title while Instant Preview detail view is open
  useEffect(() => {
    if (!activeInstantRecipe) {
      return;
    }

    const slotContainer = document.getElementById('page-slot-content');
    const previousTitle = document.title;
    if (slotContainer) {
      slotContainer.hidden = true;
    }
    document.title = `${activeInstantRecipe.title} | Ulubione przepisy Kasi`;

    return () => {
      if (slotContainer) {
        slotContainer.hidden = false;
      }
      document.title = originalTitleRef.current || previousTitle;
    };
  }, [activeInstantRecipe]);

  return (
    <>
      {/* Magic Link Pairing Toast */}
      {pairingNotice ? (
        <div
          role="status"
          aria-live="polite"
          className="catalog-item-enter mb-5 flex items-center justify-between gap-3 rounded-2xl border border-[#C9DBC9] bg-[#EDF3EE] px-4 py-3.5 text-sm font-semibold text-[#3B5542] shadow-sm"
        >
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#4A6B53] text-white">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 shrink-0 text-[#4A6B53]" aria-hidden="true" />
              <span>{pairingNotice}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setPairingNotice(null)}
            aria-label="Zamknij powiadomienie"
            className="flex min-h-[36px] min-w-[36px] shrink-0 cursor-pointer items-center justify-center rounded-lg text-[#3B5542]/70 transition-colors hover:bg-[#4A6B53]/10 hover:text-[#3B5542] touch-manipulation"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {/* Non-blocking Live AI Recipe Generation Tracker */}
      <RecipeGenerationTracker
        staticSlugs={staticSlugs}
        activeInstantRecipeSlug={activeInstantRecipe?.slug ?? null}
        onOpenRecipe={openInstantPreview}
      />

      {/* Dynamic Instant Preview Recipe Detail View */}
      {activeInstantRecipe ? (
        <RecipeDetailView
          recipe={activeInstantRecipe}
          backLabel={isHomePage ? 'Wszystkie przepisy' : 'Wróć do poprzedniej strony'}
          onBack={closeInstantPreview}
          isInstantPreview
        />
      ) : null}

      {/* Add Recipe Modal + Mobile iPhone FAB */}
      <AddRecipeModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onOpenModal={() => openModal({ initialView: 'form' })}
        initialView={modalInitialView}
        prefillUrl={modalPrefillUrl}
        staticSlugs={staticSlugs}
        showMobileFab
      />
    </>
  );
}
