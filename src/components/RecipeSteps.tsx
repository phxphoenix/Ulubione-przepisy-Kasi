import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChefHat,
  Lightbulb,
  RotateCcw,
  Sun,
} from 'lucide-react';
import type { RecipeStep } from '../types/recipe';
import { withBase } from '../utils/paths';

export interface RecipeStepsProps {
  recipeSlug: string;
  steps: RecipeStep[];
}

interface StepImageProps {
  imageUrl: string;
  alt: string;
}

function StepImage({ imageUrl, alt }: StepImageProps) {
  const resolvedSrc = withBase(imageUrl);
  const [hasError, setHasError] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    setHasError(false);
    const imgEl = imgRef.current;
    if (imgEl && imgEl.complete && imgEl.naturalWidth === 0) {
      setHasError(true);
    }
  }, [resolvedSrc]);

  if (hasError || !resolvedSrc) {
    return null;
  }

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-[#EAE5DF] bg-[#F3EEE7]">
      <img
        ref={imgRef}
        src={resolvedSrc}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setHasError(true)}
        className="max-h-72 w-full object-cover"
      />
    </div>
  );
}

export default function RecipeSteps({ recipeSlug, steps }: RecipeStepsProps) {
  const sortedSteps = useMemo(
    () => [...steps].sort((a, b) => a.stepNumber - b.stepNumber),
    [steps]
  );

  const [activeStepNumber, setActiveStepNumber] = useState<number | null>(
    sortedSteps[0]?.stepNumber ?? null
  );
  const [completedSteps, setCompletedSteps] = useState<Record<number, boolean>>(
    {}
  );

  // Screen Wake Lock state
  const [isWakeLockSupported, setIsWakeLockSupported] = useState(false);
  const [isCookingMode, setIsCookingMode] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [wakeLockNotice, setWakeLockNotice] = useState<string | null>(null);
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const cookingModeRef = useRef(false);

  useEffect(() => {
    cookingModeRef.current = isCookingMode;
  }, [isCookingMode]);

  useEffect(() => {
    setActiveStepNumber(sortedSteps[0]?.stepNumber ?? null);
    setCompletedSteps({});
  }, [recipeSlug, sortedSteps]);

  useEffect(() => {
    const supported =
      typeof navigator !== 'undefined' &&
      'wakeLock' in navigator &&
      typeof navigator.wakeLock?.request === 'function';
    setIsWakeLockSupported(supported);
  }, []);

  const releaseWakeLock = useCallback(async () => {
    const current = sentinelRef.current;
    sentinelRef.current = null;
    setWakeLockActive(false);

    if (current && !current.released) {
      try {
        await current.release();
      } catch {
        // Ignore release errors when browser already released the lock
      }
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (
      typeof navigator === 'undefined' ||
      !('wakeLock' in navigator) ||
      typeof navigator.wakeLock?.request !== 'function'
    ) {
      setWakeLockNotice(
        'Twoja przeglądarka nie obsługuje blokady wygaszania ekranu.'
      );
      setIsCookingMode(false);
      return false;
    }

    try {
      if (sentinelRef.current && !sentinelRef.current.released) {
        setWakeLockActive(true);
        setWakeLockNotice(null);
        return true;
      }

      const sentinel = await navigator.wakeLock.request('screen');
      sentinelRef.current = sentinel;
      setWakeLockActive(true);
      setWakeLockNotice(null);

      sentinel.addEventListener('release', () => {
        if (sentinelRef.current === sentinel) {
          sentinelRef.current = null;
          setWakeLockActive(false);
        }
      });
      return true;
    } catch {
      setWakeLockActive(false);
      setIsCookingMode(false);
      setWakeLockNotice(
        'Nie udało się włączyć blokady ekranu (sprawdź tryb oszczędzania baterii lub HTTPS).'
      );
      return false;
    }
  }, []);

  useEffect(() => {
    if (!isCookingMode) {
      return;
    }

    function handleVisibilityChange() {
      if (
        document.visibilityState === 'visible' &&
        cookingModeRef.current
      ) {
        void requestWakeLock();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isCookingMode, requestWakeLock]);

  useEffect(() => {
    return () => {
      void releaseWakeLock();
    };
  }, [releaseWakeLock]);

  async function handleToggleCookingMode() {
    if (isCookingMode) {
      setIsCookingMode(false);
      setWakeLockNotice(null);
      await releaseWakeLock();
      return;
    }

    setIsCookingMode(true);
    setWakeLockNotice(null);
    await requestWakeLock();
  }

  function handleSelectStep(stepNumber: number) {
    setActiveStepNumber((prev) => (prev === stepNumber ? null : stepNumber));
  }

  function handleToggleCompleted(stepNumber: number) {
    setCompletedSteps((prev) => {
      const nextCompleted = !prev[stepNumber];
      const next = { ...prev };
      if (nextCompleted) {
        next[stepNumber] = true;
      } else {
        delete next[stepNumber];
      }

      if (nextCompleted && activeStepNumber === stepNumber) {
        const nextPending = sortedSteps.find(
          (step) => step.stepNumber > stepNumber && !next[step.stepNumber]
        );
        const anyPending =
          nextPending ??
          sortedSteps.find((step) => !next[step.stepNumber]);
        setActiveStepNumber(anyPending?.stepNumber ?? null);
      }

      return next;
    });
  }

  function handleResetProgress() {
    setCompletedSteps({});
    setActiveStepNumber(sortedSteps[0]?.stepNumber ?? null);
  }

  const completedCount = Object.values(completedSteps).filter(Boolean).length;

  return (
    <section aria-labelledby="steps-heading" className="space-y-4">
      {/* Header + Cooking Mode Wake Lock Toggle */}
      <div className="flex flex-col gap-3 rounded-2xl border border-[#EAE5DF] bg-white p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#4A6B53]/10 text-[#4A6B53]">
            <ChefHat className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2
              id="steps-heading"
              className="font-serif text-xl font-bold text-[#1F2421] sm:text-2xl"
            >
              Przygotowanie krok po kroku
            </h2>
            <p className="text-xs font-medium text-[#1F2421]/60 sm:text-sm">
              {completedCount > 0
                ? `Ukończono ${completedCount} z ${sortedSteps.length} kroków`
                : 'Kliknij krok, aby podświetlić go podczas gotowania'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {completedCount > 0 ? (
            <button
              type="button"
              onClick={handleResetProgress}
              className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl border border-[#EAE5DF] bg-[#FAF8F5] px-3 text-xs font-semibold text-[#1F2421]/75 transition-colors hover:border-[#4A6B53]/40 hover:text-[#1F2421] active:scale-[0.98] touch-manipulation"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Resetuj</span>
            </button>
          ) : null}

          <button
            type="button"
            role="switch"
            aria-checked={isCookingMode}
            onClick={handleToggleCookingMode}
            disabled={!isWakeLockSupported && !isCookingMode}
            className={`inline-flex min-h-[48px] w-full cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-left transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6B53] ${
              isCookingMode && wakeLockActive
                ? 'border-[#4A6B53] bg-[#4A6B53] text-white shadow-sm'
                : 'border-[#EAE5DF] bg-[#FAF8F5] text-[#1F2421] hover:border-[#4A6B53]/40'
            }`}
          >
            <span className="flex items-center gap-2 text-xs font-semibold sm:text-sm">
              <Sun
                className={`h-4 w-4 shrink-0 ${
                  isCookingMode && wakeLockActive
                    ? 'text-[#FDF4E3]'
                    : 'text-[#C86D51]'
                }`}
                aria-hidden="true"
              />
              <span>Tryb gotowania (Nie wygaszaj ekranu)</span>
            </span>

            <span
              aria-hidden="true"
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                isCookingMode && wakeLockActive
                  ? 'bg-white/25'
                  : 'bg-[#D8D1C7]'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform ${
                  isCookingMode && wakeLockActive
                    ? 'translate-x-6'
                    : 'translate-x-1'
                }`}
              />
            </span>
          </button>
        </div>
      </div>

      {wakeLockNotice ? (
        <p
          role="status"
          className="rounded-xl border border-[#EED9B7] bg-[#FDF4E3] px-4 py-2.5 text-xs font-medium text-[#945B17]"
        >
          {wakeLockNotice}
        </p>
      ) : null}

      {/* Steps List */}
      <ol className="space-y-4">
        {sortedSteps.map((step) => {
          const isActive = activeStepNumber === step.stepNumber;
          const isCompleted = Boolean(completedSteps[step.stepNumber]);

          return (
            <li key={step.stepNumber}>
              <article
                aria-current={isActive ? 'step' : undefined}
                onClick={() => {
                  const selection = window.getSelection()?.toString();
                  if (!selection) {
                    handleSelectStep(step.stepNumber);
                  }
                }}
                className={`cursor-pointer rounded-2xl border p-4 transition-all duration-200 sm:p-6 ${
                  isActive
                    ? 'border-[#4A6B53] bg-white shadow-md ring-2 ring-[#4A6B53]/15'
                    : isCompleted
                      ? 'border-[#EAE5DF] bg-white/75 opacity-75'
                      : 'border-[#EAE5DF] bg-white shadow-xs hover:border-[#4A6B53]/35'
                }`}
              >
                <div className="flex items-start gap-3 sm:gap-4">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleSelectStep(step.stepNumber);
                    }}
                    aria-label={`Krok ${step.stepNumber}: ${step.title || 'aktywuj krok'}`}
                    className="flex min-h-[44px] flex-1 cursor-pointer items-center gap-3 rounded-xl text-left sm:gap-4 touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6B53]"
                  >
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-serif text-lg font-bold tabular-nums transition-colors sm:h-11 sm:w-11 sm:text-xl ${
                        isCompleted
                          ? 'bg-[#4A6B53] text-white'
                          : isActive
                            ? 'bg-[#C86D51] text-white shadow-xs'
                            : 'border border-[#EAE5DF] bg-[#FAF8F5] text-[#1F2421]'
                      }`}
                    >
                      {isCompleted ? (
                        <Check
                          className="h-5 w-5 stroke-[2.5]"
                          aria-hidden="true"
                        />
                      ) : (
                        step.stepNumber
                      )}
                    </span>

                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      <span
                        className={`font-serif text-base font-bold leading-snug sm:text-lg ${
                          isCompleted
                            ? 'text-[#1F2421]/65 line-through'
                            : 'text-[#1F2421]'
                        }`}
                      >
                        {step.title || `Krok ${step.stepNumber}`}
                      </span>

                      {isActive && !isCompleted ? (
                        <span className="inline-flex items-center rounded-full bg-[#4A6B53]/10 px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-[#4A6B53]">
                          Aktualnie wykonywany
                        </span>
                      ) : null}

                      {isCompleted ? (
                        <span className="inline-flex items-center rounded-full bg-[#EDF3EE] px-2.5 py-0.5 text-[11px] font-semibold text-[#3B5542]">
                          Ukończony
                        </span>
                      ) : null}
                    </span>
                  </button>

                  {/* Separate 44x44px button to mark step completed */}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleToggleCompleted(step.stepNumber);
                    }}
                    aria-label={
                      isCompleted
                        ? `Cofnij ukończenie kroku ${step.stepNumber}`
                        : `Oznacz krok ${step.stepNumber} jako ukończony`
                    }
                    aria-pressed={isCompleted}
                    className={`flex min-h-[44px] min-w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-xl border transition-all active:scale-95 touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6B53] ${
                      isCompleted
                        ? 'border-[#4A6B53] bg-[#EDF3EE] text-[#3B5542]'
                        : 'border-[#EAE5DF] bg-[#FAF8F5] text-[#1F2421]/45 hover:border-[#4A6B53]/40 hover:text-[#4A6B53]'
                    }`}
                  >
                    <Check className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>

                <div className="mt-3 sm:pl-[3.75rem]">
                  <p
                    className={`text-[15px] leading-relaxed sm:text-base ${
                      isCompleted ? 'text-[#1F2421]/60' : 'text-[#1F2421]/85'
                    }`}
                  >
                    {step.instruction}
                  </p>

                  {step.imageUrl ? (
                    <StepImage
                      imageUrl={step.imageUrl}
                      alt={
                        step.title
                          ? `${step.title} — krok ${step.stepNumber}`
                          : `Krok ${step.stepNumber}`
                      }
                    />
                  ) : null}

                  {step.tip ? (
                    <div className="mt-3.5 flex items-start gap-2.5 rounded-xl border border-[#EED9B7] bg-[#FDF4E3]/75 px-4 py-3 text-sm leading-relaxed text-[#6E4412]">
                      <Lightbulb
                        className="mt-0.5 h-4 w-4 shrink-0 text-[#945B17]"
                        aria-hidden="true"
                      />
                      <div>
                        <span className="font-bold text-[#945B17]">
                          Wskazówka:{' '}
                        </span>
                        <span>{step.tip}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              </article>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
