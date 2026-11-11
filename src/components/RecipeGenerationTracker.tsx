import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChefHat,
  Clock,
  ExternalLink,
  KeyRound,
  Loader2,
  RotateCcw,
  Sparkles,
  Utensils,
  X,
} from 'lucide-react';
import type { Recipe } from '../types/recipe';
import {
  fetchRecipeDirectoryFiles,
  fetchRecipeJsonFile,
  fetchWorkflowDispatchRuns,
  fetchWorkflowRunById,
  fetchWorkflowRunJobs,
  GITHUB_CONFIG,
  GitHubApiError,
  type GitHubContentEntry,
  type GitHubWorkflowJob,
  type GitHubWorkflowRun,
} from '../utils/githubClient';
import {
  getStoredTrackerJob,
  requestOpenAddRecipeModal,
  requestOpenInstantRecipe,
  saveInstantRecipe,
  saveTrackerJob,
  TRACKER_JOB_CHANGED_EVENT,
  type ActiveTrackerJob,
} from '../utils/instantRecipes';
import { formatTotalTime } from '../utils/recipe';

export interface RecipeGenerationTrackerProps {
  staticSlugs?: string[];
  activeInstantRecipeSlug?: string | null;
  onOpenRecipe?: (recipe: Recipe) => void;
}

const POLL_INTERVAL_MS = 4000;
const RUN_DISCOVERY_TIMEOUT_MS = 90_000;

const CULINARY_FACTS: readonly string[] = [
  'Szczypta soli w deserach czekoladowych i karmelowych wzmacnia słodycz i pogłębia smak kakao.',
  'Woda po gotowaniu makaronu zawiera skrobię, która zamienia oliwę lub masło w aksamitny, błyszczący sos.',
  'Cynamon cejloński ma łagodny, lekko cytrusowy aromat, podczas gdy popularna kasja jest ostrzejsza i intensywniejsza.',
  'Czosnek wrzucony na zbyt gorący tłuszcz szybko staje się gorzki — najlepiej delikatnie zeszklić go na średnim ogniu.',
  'Odstawienie pieczonego lub smażonego mięsa na 5–10 minut pozwala sokom równomiernie rozprowadzić się we włóknach.',
  'Kilka kropel soku z cytryny lub octu dodanych na sam koniec gotowania ożywia smak zupy bez dosypywania soli.',
  'Prażenie całych przypraw na suchej patelni przez 30 sekund uwalnia olejki eteryczne i podbija aromat potrawy.',
  'Składniki ciasta drożdżowego łączą się najlepiej, gdy masło, jajko i mleko mają zbliżoną, letnią temperaturę.',
];

function formatElapsedTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function normalizeUrlForComparison(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

function isAddRecipeWorkflowRun(run: GitHubWorkflowRun): boolean {
  if (run.path) {
    return (
      run.path.endsWith(`/${GITHUB_CONFIG.workflowFile}`) ||
      run.path === `.github/workflows/${GITHUB_CONFIG.workflowFile}`
    );
  }
  if (run.name) {
    return (
      run.name.toLowerCase().includes('dodaj przepis') ||
      run.name.toLowerCase().includes('recipe')
    );
  }
  return true;
}

function findGenerateRecipeJob(
  jobs: GitHubWorkflowJob[]
): GitHubWorkflowJob | undefined {
  if (jobs.length === 0) {
    return undefined;
  }
  const matched = jobs.find((job) => {
    const lower = job.name.toLowerCase();
    return (
      lower === 'generate-recipe' ||
      lower.includes('generuj przepis') ||
      lower.includes('agenta ai') ||
      lower.includes('agent ai')
    );
  });
  return matched ?? (jobs.length === 1 ? jobs[0] : undefined);
}

function describeWorkflowFailure(conclusion: string | null): string {
  switch (conclusion) {
    case 'cancelled':
      return 'Wykonanie zadania na GitHub Actions zostało anulowane.';
    case 'timed_out':
      return 'Przekroczono limit czasu wykonania Agenta AI na GitHub Actions.';
    default:
      return 'Agent AI napotkał błąd podczas pobierania lub przetwarzania przepisu ze wskazanej strony.';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function RecipeGenerationTracker({
  staticSlugs = [],
  activeInstantRecipeSlug = null,
  onOpenRecipe,
}: RecipeGenerationTrackerProps) {
  const [job, setJob] = useState<ActiveTrackerJob | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const jobRef = useRef<ActiveTrackerJob | null>(null);
  const isPollingInFlightRef = useRef(false);
  const lastPollAtRef = useRef(0);

  const updateJob = useCallback((nextJob: ActiveTrackerJob | null) => {
    jobRef.current = nextJob;
    setJob(nextJob);
    saveTrackerJob(nextJob, { emit: false });
  }, []);

  // Load persisted job from localStorage on mount and subscribe to updates
  useEffect(() => {
    const initial = getStoredTrackerJob();
    jobRef.current = initial;
    setJob(initial);
    if (initial) {
      const endMs = initial.completedAt ?? Date.now();
      setElapsedSeconds(Math.max(0, Math.floor((endMs - initial.startedAt) / 1000)));
    }

    function handleJobChanged(event: Event) {
      const custom = event as CustomEvent<ActiveTrackerJob | null>;
      const next = custom.detail ?? getStoredTrackerJob();
      jobRef.current = next;
      setJob(next);
      if (next) {
        const endMs = next.completedAt ?? Date.now();
        setElapsedSeconds(Math.max(0, Math.floor((endMs - next.startedAt) / 1000)));
      }
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === 'kasia_recipe_tracker_job') {
        const synced = getStoredTrackerJob();
        jobRef.current = synced;
        setJob(synced);
      }
    }

    window.addEventListener(TRACKER_JOB_CHANGED_EVENT, handleJobChanged);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(TRACKER_JOB_CHANGED_EVENT, handleJobChanged);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // Elapsed seconds ticker while job is running
  useEffect(() => {
    if (
      !job ||
      job.stage === 'completed' ||
      job.stage === 'error'
    ) {
      if (job?.completedAt) {
        setElapsedSeconds(
          Math.max(0, Math.floor((job.completedAt - job.startedAt) / 1000))
        );
      }
      return;
    }

    const updateElapsed = () => {
      setElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - job.startedAt) / 1000))
      );
    };

    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(interval);
  }, [job]);

  const fetchAndFinalizeInstantRecipe = useCallback(
    async (currentJob: ActiveTrackerJob) => {
      const previewJob: ActiveTrackerJob = {
        ...currentJob,
        stage: 'fetching_preview',
      };
      updateJob(previewJob);

      const knownFilenames = new Set(
        currentJob.baselineFilenames.length > 0
          ? currentJob.baselineFilenames
          : staticSlugs.map((slug) => `${slug}.json`)
      );

      let newEntries: GitHubContentEntry[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const entries = await fetchRecipeDirectoryFiles();
        newEntries = entries.filter((entry) => !knownFilenames.has(entry.name));
        if (newEntries.length > 0) {
          break;
        }
        if (attempt < 2) {
          await sleep(1400);
        }
      }

      if (newEntries.length === 0) {
        // Fallback: if baseline snapshot occurred slightly after commit, look for URL match among recent files
        const allEntries = await fetchRecipeDirectoryFiles();
        const fallbackCandidates = allEntries.filter(
          (entry) => !staticSlugs.includes(entry.name.replace(/\.json$/i, ''))
        );
        newEntries = fallbackCandidates.slice(0, 5);
      }

      if (newEntries.length === 0) {
        throw new GitHubApiError(
          'Workflow zakończył się sukcesem, ale nie udało się jeszcze odnaleźć nowego pliku przepisu w repozytorium. Odśwież stronę za kilkadziesiąt sekund.',
          'NOT_FOUND'
        );
      }

      let selectedRecipe: Recipe | null = null;
      let selectedFilename = newEntries[0].name;

      if (newEntries.length === 1) {
        selectedRecipe = await fetchRecipeJsonFile(newEntries[0].path);
        selectedFilename = newEntries[0].name;
      } else {
        const targetNormalized = normalizeUrlForComparison(
          currentJob.recipeUrl
        );
        const settled = await Promise.allSettled(
          newEntries.slice(0, 6).map(async (entry) => ({
            entry,
            recipe: await fetchRecipeJsonFile(entry.path),
          }))
        );

        const loaded = settled
          .filter(
            (
              item
            ): item is PromiseFulfilledResult<{
              entry: (typeof newEntries)[number];
              recipe: Recipe;
            }> => item.status === 'fulfilled'
          )
          .map((item) => item.value);

        const exactUrlMatch = loaded.find(
          (item) =>
            normalizeUrlForComparison(item.recipe.sourceUrl) ===
            targetNormalized
        );

        const picked =
          exactUrlMatch ??
          loaded.sort(
            (a, b) =>
              Date.parse(b.recipe.createdAt) - Date.parse(a.recipe.createdAt)
          )[0];

        if (picked) {
          selectedRecipe = picked.recipe;
          selectedFilename = picked.entry.name;
        }
      }

      if (!selectedRecipe) {
        throw new GitHubApiError(
          'Nie udało się wczytać wygenerowanego pliku przepisu JSON z GitHub.',
          'UNKNOWN'
        );
      }

      saveInstantRecipe(selectedRecipe);

      updateJob({
        ...previewJob,
        stage: 'completed',
        completedAt: Date.now(),
        recipe: selectedRecipe,
        matchedFilename: selectedFilename,
      });
    },
    [staticSlugs, updateJob]
  );

  const pollOnce = useCallback(async () => {
    const current = jobRef.current;
    if (
      !current ||
      current.stage === 'completed' ||
      current.stage === 'error' ||
      isPollingInFlightRef.current
    ) {
      return;
    }

    isPollingInFlightRef.current = true;
    lastPollAtRef.current = Date.now();

    try {
      if (current.stage === 'fetching_preview') {
        await fetchAndFinalizeInstantRecipe(current);
        return;
      }

      const runs = await fetchWorkflowDispatchRuns(3);
      let matchedRun: GitHubWorkflowRun | undefined;

      if (current.runId) {
        matchedRun = runs.find((run) => run.id === current.runId);
        if (!matchedRun) {
          try {
            matchedRun = await fetchWorkflowRunById(current.runId);
          } catch {
            // Keep waiting until run endpoint resolves
          }
        }
      } else {
        const baselineSet = new Set(current.baselineRunIds);
        const candidates = runs.filter((run) => {
          if (!isAddRecipeWorkflowRun(run)) {
            return false;
          }
          if (baselineSet.size > 0) {
            return !baselineSet.has(run.id);
          }
          const createdMs = Date.parse(run.created_at);
          return !Number.isNaN(createdMs) && createdMs >= current.startedAt - 120_000;
        });

        matchedRun = candidates[0];
      }

      if (!matchedRun) {
        if (Date.now() - current.startedAt > RUN_DISCOVERY_TIMEOUT_MS) {
          updateJob({
            ...current,
            stage: 'error',
            completedAt: Date.now(),
            runHtmlUrl: `https://github.com/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/actions`,
            errorMessage:
              'Nie wykryto uruchomionego procesu w GitHub Actions w oczekiwanym czasie. Sprawdź logi workflowu.',
          });
        }
        return;
      }

      const withRunMeta: ActiveTrackerJob = {
        ...current,
        runId: matchedRun.id,
        runHtmlUrl: matchedRun.html_url,
      };

      if (matchedRun.status === 'completed') {
        if (matchedRun.conclusion === 'success') {
          await fetchAndFinalizeInstantRecipe(withRunMeta);
          return;
        }

        // Check whether generate-recipe job itself succeeded even if deploy-gh-pages failed
        try {
          const jobs = await fetchWorkflowRunJobs(matchedRun.id);
          const genJob = findGenerateRecipeJob(jobs);
          if (
            genJob?.status === 'completed' &&
            genJob.conclusion === 'success'
          ) {
            await fetchAndFinalizeInstantRecipe(withRunMeta);
            return;
          }
        } catch {
          // Fall through to normal workflow error reporting
        }

        updateJob({
          ...withRunMeta,
          stage: 'error',
          completedAt: Date.now(),
          errorMessage: describeWorkflowFailure(matchedRun.conclusion),
        });
        return;
      }

      if (matchedRun.status === 'in_progress') {
        if (withRunMeta.stage !== 'in_progress') {
          updateJob({
            ...withRunMeta,
            stage: 'in_progress',
          });
        } else if (!current.runId) {
          updateJob(withRunMeta);
        }

        // Inspect jobs inside the run so Instant Preview triggers as soon as
        // `generate-recipe` commits the JSON to main, before `deploy-gh-pages` finishes!
        try {
          const jobs = await fetchWorkflowRunJobs(matchedRun.id);
          const genJob = findGenerateRecipeJob(jobs);
          if (genJob?.status === 'completed') {
            if (genJob.conclusion === 'success') {
              await fetchAndFinalizeInstantRecipe(withRunMeta);
              return;
            }
            if (genJob.conclusion) {
              updateJob({
                ...withRunMeta,
                stage: 'error',
                completedAt: Date.now(),
                errorMessage: describeWorkflowFailure(genJob.conclusion),
              });
              return;
            }
          }
        } catch {
          // Continue polling run status on next tick
        }
        return;
      }

      // Otherwise still queued / waiting / requested
      if (
        withRunMeta.stage !== 'queued' ||
        withRunMeta.runId !== current.runId
      ) {
        updateJob({
          ...withRunMeta,
          stage: 'queued',
        });
      }
    } catch (error) {
      if (error instanceof GitHubApiError) {
        if (
          error.code === 'NO_TOKEN' ||
          error.code === 'UNAUTHORIZED' ||
          error.code === 'FORBIDDEN' ||
          error.code === 'NOT_FOUND'
        ) {
          updateJob({
            ...current,
            stage: 'error',
            completedAt: Date.now(),
            errorCode: error.code,
            errorMessage: error.message,
          });
        }
      }
    } finally {
      isPollingInFlightRef.current = false;
    }
  }, [fetchAndFinalizeInstantRecipe, updateJob]);

  // 4-second polling loop while job is active + immediate resume on Safari visibility restore
  const isJobActive =
    job !== null &&
    (job.stage === 'queued' ||
      job.stage === 'in_progress' ||
      job.stage === 'fetching_preview');

  useEffect(() => {
    if (!isJobActive) {
      return;
    }

    let cancelled = false;
    let timerId: number | null = null;

    async function scheduleNext() {
      await pollOnce();
      if (!cancelled && jobRef.current && jobRef.current.stage !== 'completed' && jobRef.current.stage !== 'error') {
        timerId = window.setTimeout(scheduleNext, POLL_INTERVAL_MS);
      }
    }

    void scheduleNext();

    function handleVisibilityChange() {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastPollAtRef.current >= 2000
      ) {
        void pollOnce();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isJobActive, job?.id, pollOnce]);

  if (!job) {
    return null;
  }

  function handleDismiss() {
    updateJob(null);
  }

  function handleOpenCompletedRecipe() {
    if (!job?.recipe) {
      return;
    }
    if (onOpenRecipe) {
      onOpenRecipe(job.recipe);
    } else {
      requestOpenInstantRecipe(job.recipe);
    }
  }

  const factIndex = Math.floor(elapsedSeconds / 7) % CULINARY_FACTS.length;
  const sourceHost = extractHostname(job.recipeUrl);

  const progressPercent =
    job.stage === 'queued'
      ? 24
      : job.stage === 'in_progress'
        ? 64
        : job.stage === 'fetching_preview'
          ? 90
          : job.stage === 'completed'
            ? 100
            : 100;

  const isViewingThisRecipe =
    job.stage === 'completed' &&
    Boolean(job.recipe?.slug) &&
    activeInstantRecipeSlug === job.recipe?.slug;

  return (
    <aside
      aria-live="polite"
      aria-label="Status generowania przepisu przez Agenta AI"
      className="catalog-item-enter mb-6"
    >
      {job.stage === 'completed' && job.recipe ? (
        <div className="overflow-hidden rounded-2xl border border-[#C9DBC9] bg-gradient-to-br from-[#EDF3EE] via-white to-white p-4 shadow-sm sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#4A6B53] text-white shadow-2xs">
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#4A6B53]/12 px-2.5 py-0.5 text-[11px] font-bold text-[#3B5542]">
                    <Sparkles className="h-3 w-3" aria-hidden="true" />
                    <span>Nowość – właśnie dodano!</span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-[#1F2421]/55 tabular-nums">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Gotowe w {formatElapsedTime(elapsedSeconds)}</span>
                  </span>
                </div>

                <h3 className="mt-1.5 font-serif text-lg font-bold leading-snug text-[#1F2421] sm:text-xl">
                  {job.recipe.title}
                </h3>

                <p className="mt-1 text-xs leading-relaxed text-[#1F2421]/65 sm:text-sm">
                  {job.recipe.category} ·{' '}
                  {formatTotalTime(job.recipe.totalTimeMinutes)} · Przepis jest
                  już na górze listy i gotowy do podglądu (strona statyczna
                  odświeży się w tle za ok. 1–2 min).
                </p>

                <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
                  {!isViewingThisRecipe ? (
                    <button
                      type="button"
                      onClick={handleOpenCompletedRecipe}
                      className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl bg-[#4A6B53] px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-[#3B5542] active:scale-[0.98] sm:text-sm touch-manipulation"
                    >
                      <span>Otwórz gotowy przepis teraz</span>
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : (
                    <span className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#C9DBC9] bg-[#EDF3EE] px-3 py-1.5 text-xs font-semibold text-[#3B5542]">
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      <span>Oglądasz ten przepis w podglądzie na żywo</span>
                    </span>
                  )}

                  {job.runHtmlUrl ? (
                    <a
                      href={job.runHtmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[#EAE5DF] bg-white px-3.5 py-2 text-xs font-semibold text-[#1F2421]/70 transition-colors hover:border-[#4A6B53]/40 hover:text-[#1F2421] touch-manipulation"
                    >
                      <span>Szczegóły runu</span>
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Zamknij powiadomienie o gotowym przepisie"
              className="flex min-h-[40px] min-w-[40px] shrink-0 cursor-pointer items-center justify-center rounded-xl text-[#1F2421]/45 transition-colors hover:bg-[#EAE5DF]/40 hover:text-[#1F2421] touch-manipulation"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : job.stage === 'error' ? (
        <div
          role="alert"
          className="overflow-hidden rounded-2xl border border-[#F2CED6] bg-[#FCF0F2] p-4 shadow-sm sm:p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#A24156] text-white">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </div>

              <div className="min-w-0 space-y-2">
                <div>
                  <span className="text-[11px] font-bold tracking-wide text-[#A24156] uppercase">
                    Nie udało się pobrać przepisu · {sourceHost}
                  </span>
                  <p className="mt-1 text-sm font-medium leading-relaxed text-[#1F2421]">
                    {job.errorMessage ||
                      'Wystąpił błąd podczas uruchamiania lub wykonywania Agenta AI.'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {job.errorCode === 'NO_TOKEN' ||
                  job.errorCode === 'UNAUTHORIZED' ||
                  job.errorCode === 'FORBIDDEN' ? (
                    <button
                      type="button"
                      onClick={() =>
                        requestOpenAddRecipeModal({ initialView: 'settings' })
                      }
                      className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl bg-[#A24156] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#893547] active:scale-[0.98] touch-manipulation"
                    >
                      <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Skonfiguruj token</span>
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={() =>
                      requestOpenAddRecipeModal({
                        initialView: 'form',
                        prefillUrl: job.recipeUrl,
                      })
                    }
                    className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl border border-[#F2CED6] bg-white px-3.5 py-2 text-xs font-semibold text-[#1F2421] transition-colors hover:border-[#A24156]/40 active:scale-[0.98] touch-manipulation"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Spróbuj ponownie</span>
                  </button>

                  {job.runHtmlUrl ? (
                    <a
                      href={job.runHtmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[#F2CED6] bg-white px-3.5 py-2 text-xs font-semibold text-[#A24156] transition-colors hover:bg-white/80 touch-manipulation"
                    >
                      <span>Zobacz logi wykonania</span>
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Zamknij komunikat błędu"
              className="flex min-h-[40px] min-w-[40px] shrink-0 cursor-pointer items-center justify-center rounded-xl text-[#A24156]/70 transition-colors hover:bg-[#F2CED6]/40 hover:text-[#A24156] touch-manipulation"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#EAE5DF] bg-white p-4 shadow-sm sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#4A6B53]/10 text-[#4A6B53]">
                {job.stage === 'queued' ? (
                  <Loader2
                    className="h-5 w-5 animate-spin text-[#C86D51]"
                    aria-hidden="true"
                  />
                ) : job.stage === 'fetching_preview' ? (
                  <Sparkles
                    className="h-5 w-5 animate-pulse text-[#4A6B53]"
                    aria-hidden="true"
                  />
                ) : (
                  <ChefHat
                    className="h-5 w-5 animate-pulse text-[#4A6B53]"
                    aria-hidden="true"
                  />
                )}
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FAF8F5] border border-[#EAE5DF] px-2.5 py-0.5 text-[11px] font-semibold text-[#1F2421]/70">
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#4A6B53]"
                    />
                    <span>{sourceHost}</span>
                  </span>

                  <span className="inline-flex items-center gap-1 rounded-full bg-[#EDF3EE] px-2.5 py-0.5 text-[11px] font-bold text-[#3B5542] tabular-nums">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    <span>{formatElapsedTime(elapsedSeconds)}</span>
                  </span>
                </div>

                <h3 className="mt-1.5 font-serif text-base font-bold text-[#1F2421] sm:text-lg">
                  {job.stage === 'queued'
                    ? 'Wysłano link do kuchni AI...'
                    : job.stage === 'fetching_preview'
                      ? 'Przepis gotowy! Pobieranie podglądu...'
                      : 'Agent pobiera przepis, tłumaczy i odrzuca zbędne opisy...'}
                </h3>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {job.runHtmlUrl ? (
                <a
                  href={job.runHtmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Podgląd logów na GitHub"
                  className="hidden min-h-[36px] items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-[#1F2421]/55 transition-colors hover:bg-[#FAF8F5] hover:text-[#4A6B53] sm:inline-flex"
                >
                  <span>Logi</span>
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              ) : null}

              <button
                type="button"
                onClick={handleDismiss}
                aria-label="Ukryj pasek postępu"
                title="Ukryj pasek (zadanie nadal wykona się w tle)"
                className="flex min-h-[36px] min-w-[36px] cursor-pointer items-center justify-center rounded-lg text-[#1F2421]/40 transition-colors hover:bg-[#FAF8F5] hover:text-[#1F2421]/75 touch-manipulation"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* 3-stage progress bar */}
          <div className="mt-3.5 space-y-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-[#F3EEE7]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#C86D51] via-[#4A6B53] to-[#4A6B53] transition-all duration-700 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="grid grid-cols-3 gap-2 text-[11px] font-semibold">
              <span
                className={
                  job.stage === 'queued'
                    ? 'text-[#C86D51]'
                    : 'text-[#4A6B53]'
                }
              >
                1. W kolejce AI
              </span>
              <span
                className={`text-center ${
                  job.stage === 'in_progress'
                    ? 'text-[#4A6B53]'
                    : job.stage === 'fetching_preview'
                      ? 'text-[#4A6B53]'
                      : 'text-[#1F2421]/40'
                }`}
              >
                2. Tłumaczenie i ekstrakcja
              </span>
              <span
                className={`text-right ${
                  job.stage === 'fetching_preview'
                    ? 'text-[#4A6B53]'
                    : 'text-[#1F2421]/40'
                }`}
              >
                3. Instant Preview
              </span>
            </div>
          </div>

          {/* Rotating culinary trivia while AI works */}
          {job.stage === 'in_progress' ? (
            <div className="mt-3.5 flex items-start gap-2.5 rounded-xl border border-[#EED9B7]/80 bg-[#FDF4E3]/60 px-3.5 py-2.5 text-xs leading-relaxed text-[#6E4412]">
              <Utensils
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#945B17]"
                aria-hidden="true"
              />
              <p>
                <strong className="font-bold text-[#945B17]">
                  Kuchenna ciekawostka:{' '}
                </strong>
                <span>{CULINARY_FACTS[factIndex]}</span>
              </p>
            </div>
          ) : null}
        </div>
      )}
    </aside>
  );
}
