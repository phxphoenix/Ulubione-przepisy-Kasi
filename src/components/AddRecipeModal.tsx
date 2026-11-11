import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type SyntheticEvent,
} from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Loader2,
  Plus,
  Settings,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import {
  buildMagicLink,
  dispatchAddRecipeWorkflow,
  fetchRecipeDirectoryFiles,
  fetchWorkflowDispatchRuns,
  GITHUB_CONFIG,
  GitHubApiError,
  getGitHubToken,
  removeGitHubToken,
  setGitHubToken,
  testGitHubConnection,
  TOKEN_CHANGED_EVENT,
  validateRecipeUrl,
} from '../utils/githubClient';
import {
  getStoredTrackerJob,
  saveTrackerJob,
  type ActiveTrackerJob,
} from '../utils/instantRecipes';

export interface AddRecipeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenModal?: () => void;
  initialView?: 'form' | 'settings';
  prefillUrl?: string;
  staticSlugs?: string[];
  showMobileFab?: boolean;
  onJobDispatched?: (job: ActiveTrackerJob) => void;
}

type ModalView = 'form' | 'settings';

function createJobId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function maskMagicLink(magicLink: string): string {
  const hashIndex = magicLink.indexOf('#token=');
  if (hashIndex === -1) {
    return magicLink;
  }
  const prefix = magicLink.slice(0, hashIndex + 7);
  const rawToken = magicLink.slice(hashIndex + 7);
  if (rawToken.length <= 12) {
    return `${prefix}••••••••`;
  }
  return `${prefix}${rawToken.slice(0, 8)}••••••••${rawToken.slice(-4)}`;
}

export default function AddRecipeModal({
  isOpen,
  onClose,
  onOpenModal,
  initialView = 'form',
  prefillUrl = '',
  staticSlugs = [],
  showMobileFab = true,
  onJobDispatched,
}: AddRecipeModalProps) {
  const [view, setView] = useState<ModalView>(initialView);
  const [recipeUrl, setRecipeUrl] = useState(prefillUrl);
  const [formError, setFormError] = useState<string | null>(null);
  const [formErrorCode, setFormErrorCode] = useState<string | null>(null);
  const [isDispatching, setIsDispatching] = useState(false);
  const [hasActiveRunningJob, setHasActiveRunningJob] = useState(false);

  // Token & settings state
  const [storedToken, setStoredToken] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [tokenFeedback, setTokenFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [magicLinkCopied, setMagicLinkCopied] = useState(false);
  const [showFullMagicLink, setShowFullMagicLink] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [canReadClipboard, setCanReadClipboard] = useState(false);

  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const tokenInputRef = useRef<HTMLInputElement | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  // Sync token & browser capabilities on mount / token updates
  useEffect(() => {
    function syncTokenState() {
      const current = getGitHubToken();
      setStoredToken(current);
      setTokenInput(current ?? '');
    }

    syncTokenState();
    setCanNativeShare(
      typeof navigator !== 'undefined' && typeof navigator.share === 'function'
    );
    setCanReadClipboard(
      typeof navigator !== 'undefined' &&
        typeof navigator.clipboard?.readText === 'function'
    );

    window.addEventListener(TOKEN_CHANGED_EVENT, syncTokenState);
    return () => {
      window.removeEventListener(TOKEN_CHANGED_EVENT, syncTokenState);
    };
  }, []);

  // Reset transient view states when modal opens
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const currentToken = getGitHubToken();
    setStoredToken(currentToken);
    setTokenInput(currentToken ?? '');
    setView(initialView);
    setFormError(null);
    setFormErrorCode(null);
    setTokenFeedback(null);
    setMagicLinkCopied(false);

    if (prefillUrl) {
      setRecipeUrl(prefillUrl);
    }

    const existingJob = getStoredTrackerJob();
    setHasActiveRunningJob(
      Boolean(
        existingJob &&
          (existingJob.stage === 'queued' ||
            existingJob.stage === 'in_progress' ||
            existingJob.stage === 'fetching_preview')
      )
    );
  }, [isOpen, initialView, prefillUrl]);

  // Body scroll lock & Escape key handling
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isDispatching) {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isDispatching, onClose]);

  // Focus appropriate input after opening or switching views
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (view === 'form') {
        urlInputRef.current?.focus({ preventScroll: true });
      } else {
        tokenInputRef.current?.focus({ preventScroll: true });
      }
    }, 60);

    return () => window.clearTimeout(timer);
  }, [isOpen, view]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const effectiveTokenForMagicLink =
    tokenInput.trim() || storedToken?.trim() || '';
  const magicLinkUrl = effectiveTokenForMagicLink
    ? buildMagicLink(effectiveTokenForMagicLink)
    : '';

  async function handlePasteFromClipboard() {
    if (!navigator.clipboard?.readText) {
      return;
    }
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        setRecipeUrl(text);
        setFormError(null);
        setFormErrorCode(null);
      }
    } catch {
      // User denied clipboard permission or clipboard empty
    }
  }

  async function handleSubmitRecipe(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isDispatching) {
      return;
    }

    const urlValidation = validateRecipeUrl(recipeUrl);
    if (!urlValidation.valid || !urlValidation.normalizedUrl) {
      setFormError(urlValidation.error ?? 'Nieprawidłowy adres URL.');
      setFormErrorCode('INVALID_URL');
      return;
    }

    const activeToken = getGitHubToken();
    if (!activeToken) {
      setFormError(
        'Urządzenie nie jest jeszcze sparowane z GitHubem. Wklej token w ustawieniach lub użyj Magic Linka.'
      );
      setFormErrorCode('NO_TOKEN');
      return;
    }

    const normalizedUrl = urlValidation.normalizedUrl;
    setIsDispatching(true);
    setFormError(null);
    setFormErrorCode(null);

    try {
      // Snapshot current workflow runs and recipe filenames right before dispatch
      // so the live tracker accurately isolates the newly triggered run & JSON file.
      const [runsSnapshot, filesSnapshot] = await Promise.allSettled([
        fetchWorkflowDispatchRuns(3, activeToken),
        fetchRecipeDirectoryFiles(activeToken),
      ]);

      const baselineRunIds =
        runsSnapshot.status === 'fulfilled'
          ? runsSnapshot.value.map((run) => run.id)
          : [];

      const baselineFilenames =
        filesSnapshot.status === 'fulfilled'
          ? filesSnapshot.value.map((file) => file.name)
          : staticSlugs.map((slug) => `${slug}.json`);

      await dispatchAddRecipeWorkflow(normalizedUrl, activeToken);

      const newJob: ActiveTrackerJob = {
        id: createJobId(),
        recipeUrl: normalizedUrl,
        stage: 'queued',
        startedAt: Date.now(),
        baselineRunIds,
        baselineFilenames,
      };

      saveTrackerJob(newJob);
      onJobDispatched?.(newJob);
      setRecipeUrl('');
      onClose();
    } catch (error) {
      if (error instanceof GitHubApiError) {
        setFormError(error.message);
        setFormErrorCode(error.code);
      } else {
        setFormError(
          'Wystąpił nieoczekiwany błąd podczas zlecania zadania Agentowi AI.'
        );
        setFormErrorCode('UNKNOWN');
      }
    } finally {
      setIsDispatching(false);
    }
  }

  function handleSaveToken(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = tokenInput.trim();
    if (!trimmed) {
      setTokenFeedback({
        type: 'error',
        message: 'Wklej Fine-Grained Personal Access Token przed zapisaniem.',
      });
      return;
    }

    setGitHubToken(trimmed);
    setStoredToken(trimmed);
    setTokenInput(trimmed);
    setTokenFeedback({
      type: 'success',
      message:
        'Token został zapisany w pamięci tego urządzenia (localStorage).',
    });
    setFormError(null);
    setFormErrorCode(null);
  }

  async function handleTestConnection() {
    const candidate = tokenInput.trim() || storedToken || '';
    if (!candidate) {
      setTokenFeedback({
        type: 'error',
        message: 'Najpierw wklej token GitHub, aby sprawdzić połączenie.',
      });
      return;
    }

    setIsTestingConnection(true);
    setTokenFeedback(null);

    try {
      const result = await testGitHubConnection(candidate);
      setGitHubToken(candidate);
      setStoredToken(candidate);
      setTokenFeedback({
        type: 'success',
        message: result.workflowName
          ? `Połączenie działa! Zapisano token i wykryto workflow „${result.workflowName}”.`
          : 'Połączenie z GitHub Actions działa poprawnie! Token został zapisany.',
      });
    } catch (error) {
      const message =
        error instanceof GitHubApiError
          ? error.message
          : 'Nie udało się zweryfikować tokenu GitHub.';
      setTokenFeedback({
        type: 'error',
        message,
      });
    } finally {
      setIsTestingConnection(false);
    }
  }

  function handleClearToken() {
    removeGitHubToken();
    setStoredToken(null);
    setTokenInput('');
    setTokenFeedback({
      type: 'success',
      message: 'Usunięto token z tego urządzenia.',
    });
  }

  async function copyText(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
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
      return copied;
    } catch {
      return false;
    }
  }

  async function handleCopyMagicLink() {
    if (!magicLinkUrl) {
      return;
    }
    // Persist token automatically if the user pasted it right before copying Magic Link
    if (tokenInput.trim() && tokenInput.trim() !== storedToken) {
      setGitHubToken(tokenInput.trim());
      setStoredToken(tokenInput.trim());
    }

    const ok = await copyText(magicLinkUrl);
    if (ok) {
      setMagicLinkCopied(true);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        setMagicLinkCopied(false);
      }, 2800);
    } else {
      setTokenFeedback({
        type: 'error',
        message: 'Nie udało się automatycznie skopiować linku do schowka.',
      });
    }
  }

  async function handleShareMagicLink() {
    if (!magicLinkUrl || !navigator.share) {
      return;
    }
    try {
      await navigator.share({
        title: 'Ulubione przepisy Kasi — Magic Link',
        text: 'Kliknij ten link na telefonie, aby sparować książkę kucharską:',
        url: magicLinkUrl,
      });
    } catch {
      // User dismissed share sheet
    }
  }

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && !isDispatching) {
      onClose();
    }
  }

  const isAuthError =
    formErrorCode === 'NO_TOKEN' ||
    formErrorCode === 'UNAUTHORIZED' ||
    formErrorCode === 'FORBIDDEN';

  return (
    <>
      {/* iPhone / Mobile Floating Action Button (hidden when modal is open or on sm+) */}
      {showMobileFab && !isOpen && onOpenModal ? (
        <button
          type="button"
          onClick={onOpenModal}
          aria-label="Dodaj nowy przepis z linku"
          className="fixed right-4 bottom-[calc(1.25rem+env(safe-area-inset-bottom,0px))] z-40 inline-flex min-h-[56px] cursor-pointer items-center gap-2 rounded-full bg-[#4A6B53] px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[#1F2421]/20 ring-1 ring-white/20 transition-all duration-150 hover:bg-[#3B5542] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6B53] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAF8F5] sm:hidden touch-manipulation"
        >
          <Plus className="h-5 w-5 stroke-[2.5]" aria-hidden="true" />
          <span>Dodaj przepis</span>
        </button>
      ) : null}

      {/* Modal Backdrop & Bottom-Sheet / Dialog */}
      {isOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-recipe-modal-title"
          onClick={handleBackdropClick}
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#1F2421]/50 p-0 backdrop-blur-xs transition-opacity sm:items-center sm:p-4"
        >
          <div className="catalog-item-enter relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-[#EAE5DF] bg-[#FAF8F5] shadow-2xl sm:max-w-lg sm:rounded-3xl">
            {/* Mobile sheet grab handle */}
            <div
              aria-hidden="true"
              className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-[#1F2421]/15 sm:hidden"
            />

            {/* Modal Header */}
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[#EAE5DF] bg-[#FAF8F5]/95 px-5 pt-4 pb-3.5 backdrop-blur-md sm:px-6 sm:pt-5">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#4A6B53]/20 bg-[#4A6B53]/10 text-[#4A6B53]">
                  {view === 'form' ? (
                    <Sparkles className="h-5 w-5" aria-hidden="true" />
                  ) : (
                    <KeyRound className="h-5 w-5" aria-hidden="true" />
                  )}
                </div>
                <div className="min-w-0">
                  <h2
                    id="add-recipe-modal-title"
                    className="font-serif text-lg font-bold leading-snug text-[#1F2421] sm:text-xl"
                  >
                    {view === 'form'
                      ? 'Dodaj nowy przepis z linku'
                      : 'Ustawienia GitHub i Magic Link'}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {storedToken ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[#C9DBC9] bg-[#EDF3EE] px-2.5 py-0.5 text-[11px] font-semibold text-[#3B5542]">
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        <span>Połączono z GitHub</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[#EED9B7] bg-[#FDF4E3] px-2.5 py-0.5 text-[11px] font-semibold text-[#945B17]">
                        <AlertCircle className="h-3 w-3" aria-hidden="true" />
                        <span>Wymagany token</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setView((prev) => (prev === 'form' ? 'settings' : 'form'))
                  }
                  disabled={isDispatching}
                  aria-label={
                    view === 'form'
                      ? 'Otwórz ustawienia tokenu i Magic Linka'
                      : 'Wróć do dodawania przepisu'
                  }
                  className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl border border-[#EAE5DF] bg-white px-3 text-xs font-semibold text-[#1F2421]/80 shadow-2xs transition-all hover:border-[#4A6B53]/40 hover:text-[#4A6B53] active:scale-95 disabled:opacity-50 touch-manipulation"
                >
                  {view === 'form' ? (
                    <>
                      <Settings className="h-4 w-4" aria-hidden="true" />
                      <span className="hidden sm:inline">Ustawienia</span>
                    </>
                  ) : (
                    <>
                      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                      <span>Wróć</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  disabled={isDispatching}
                  aria-label="Zamknij okno"
                  className="flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-xl border border-[#EAE5DF] bg-white text-[#1F2421]/65 transition-all hover:bg-[#F3EEE7] hover:text-[#1F2421] active:scale-95 disabled:opacity-50 touch-manipulation"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="px-5 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:px-6 sm:pb-6">
              {view === 'form' ? (
                <form onSubmit={handleSubmitRecipe} noValidate className="space-y-4">
                  <p className="text-sm leading-relaxed text-[#1F2421]/75">
                    Wklej link do dowolnej strony z przepisem (polskiej lub
                    zagranicznej), rolki na Instagramie, TikToku albo filmu na
                    YouTube. Agent AI przetłumaczy treść, przeliczy miary na
                    metryczne i zapisze czysty przepis w kolekcji.
                  </p>

                  {!storedToken ? (
                    <div className="rounded-2xl border border-[#EED9B7] bg-[#FDF4E3] p-3.5 text-xs leading-relaxed text-[#6E4412]">
                      <div className="flex items-start gap-2.5">
                        <KeyRound
                          className="mt-0.5 h-4 w-4 shrink-0 text-[#945B17]"
                          aria-hidden="true"
                        />
                        <div className="flex-1 space-y-2">
                          <p>
                            To urządzenie nie ma jeszcze zapisanego tokenu GitHub
                            potrzebnego do uruchomienia Agenta AI.
                          </p>
                          <button
                            type="button"
                            onClick={() => setView('settings')}
                            className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg bg-[#945B17] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#7A4A12] active:scale-95 touch-manipulation"
                          >
                            <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Wklej token lub wygeneruj Magic Link</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {hasActiveRunningJob ? (
                    <div className="rounded-2xl border border-[#C9DBC9] bg-[#EDF3EE]/70 px-3.5 py-2.5 text-xs font-medium text-[#3B5542]">
                      Na pasku postępu u góry strony trwa właśnie przygotowywanie
                      poprzedniego przepisu.
                    </div>
                  ) : null}

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor="recipe-url-input"
                        className="text-xs font-bold tracking-wide text-[#1F2421]/70 uppercase"
                      >
                        Adres URL przepisu
                      </label>

                      {canReadClipboard ? (
                        <button
                          type="button"
                          onClick={handlePasteFromClipboard}
                          disabled={isDispatching}
                          className="inline-flex min-h-[32px] cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-[#4A6B53] transition-colors hover:bg-[#4A6B53]/10 active:scale-95 touch-manipulation"
                        >
                          <ClipboardPaste
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                          <span>Wklej ze schowka</span>
                        </button>
                      ) : null}
                    </div>

                    <div className="relative">
                      <Link2
                        className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[#1F2421]/45"
                        aria-hidden="true"
                      />
                      <input
                        ref={urlInputRef}
                        id="recipe-url-input"
                        type="url"
                        inputMode="url"
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        disabled={isDispatching}
                        value={recipeUrl}
                        onChange={(event) => {
                          setRecipeUrl(event.target.value);
                          if (formError) {
                            setFormError(null);
                            setFormErrorCode(null);
                          }
                        }}
                        placeholder="https://www.kwestiasmaku.com/przepis/..."
                        className="min-h-[48px] w-full rounded-xl border border-[#EAE5DF] bg-white py-3 pr-11 pl-10 text-base text-[#1F2421] shadow-2xs transition-all placeholder:text-[#1F2421]/40 focus:border-[#4A6B53] focus:outline-none focus:ring-2 focus:ring-[#4A6B53]/20 disabled:opacity-60 sm:text-sm"
                      />

                      {recipeUrl.length > 0 && !isDispatching ? (
                        <button
                          type="button"
                          onClick={() => {
                            setRecipeUrl('');
                            setFormError(null);
                            setFormErrorCode(null);
                            urlInputRef.current?.focus();
                          }}
                          aria-label="Wyczyść adres URL"
                          className="absolute top-1/2 right-1 flex min-h-[40px] min-w-[40px] -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-[#1F2421]/45 transition-colors hover:bg-[#FAF8F5] hover:text-[#1F2421] touch-manipulation"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {formError ? (
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
                          <p className="font-medium">{formError}</p>
                          {isAuthError ? (
                            <button
                              type="button"
                              onClick={() => setView('settings')}
                              className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg bg-[#A24156] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#893547] active:scale-95 touch-manipulation"
                            >
                              <KeyRound
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                              <span>Otwórz ustawienia tokenu</span>
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <button
                    type="submit"
                    disabled={isDispatching}
                    className="flex min-h-[50px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#4A6B53] px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#3B5542] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6B53] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAF8F5] touch-manipulation"
                  >
                    {isDispatching ? (
                      <>
                        <Loader2
                          className="h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />
                        <span>Wysyłanie do kuchni AI...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" aria-hidden="true" />
                        <span>Wyciągnij przepis przez AI</span>
                      </>
                    )}
                  </button>

                  <p className="text-center text-[11px] leading-relaxed text-[#1F2421]/55">
                    Po wysłaniu okno zamknie się automatycznie, a postęp pracy
                    Agenta zobaczysz na żywo na górze strony.
                  </p>
                </form>
              ) : (
                <div className="space-y-5">
                  {/* Manual Token Form */}
                  <form
                    onSubmit={handleSaveToken}
                    className="space-y-3 rounded-2xl border border-[#EAE5DF] bg-white p-4 shadow-2xs"
                  >
                    <div className="flex items-center gap-2">
                      <ShieldCheck
                        className="h-4 w-4 text-[#4A6B53]"
                        aria-hidden="true"
                      />
                      <h3 className="font-serif text-base font-bold text-[#1F2421]">
                        Fine-Grained Personal Access Token
                      </h3>
                    </div>

                    <p className="text-xs leading-relaxed text-[#1F2421]/65">
                      Token jest zapisywany wyłącznie lokalnie w przeglądarce
                      pod kluczem{' '}
                      <code className="rounded bg-[#FAF8F5] px-1.5 py-0.5 font-mono text-[11px] text-[#1F2421]">
                        {GITHUB_CONFIG.tokenStorageKey}
                      </code>
                      .
                    </p>

                    <div className="relative">
                      <input
                        ref={tokenInputRef}
                        type={showToken ? 'text' : 'password'}
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        value={tokenInput}
                        onChange={(event) => {
                          setTokenInput(event.target.value);
                          setTokenFeedback(null);
                        }}
                        placeholder="github_pat_... lub ghp_..."
                        aria-label="GitHub Personal Access Token"
                        className="min-h-[48px] w-full rounded-xl border border-[#EAE5DF] bg-[#FAF8F5] py-2.5 pr-12 pl-3.5 font-mono text-base text-[#1F2421] transition-all placeholder:font-sans placeholder:text-[#1F2421]/40 focus:border-[#4A6B53] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#4A6B53]/20 sm:text-sm"
                      />

                      <button
                        type="button"
                        onClick={() => setShowToken((prev) => !prev)}
                        aria-label={showToken ? 'Ukryj token' : 'Pokaż token'}
                        className="absolute top-1/2 right-1 flex min-h-[40px] min-w-[40px] -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-[#1F2421]/55 hover:bg-[#EAE5DF]/40 hover:text-[#1F2421] touch-manipulation"
                      >
                        {showToken ? (
                          <EyeOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="submit"
                        className="inline-flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-[#4A6B53] px-4 py-2 text-xs font-semibold text-white shadow-2xs transition-all hover:bg-[#3B5542] active:scale-[0.98] touch-manipulation"
                      >
                        <Check className="h-4 w-4" aria-hidden="true" />
                        <span>Zapisz token</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleTestConnection}
                        disabled={isTestingConnection}
                        className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-[#EAE5DF] bg-[#FAF8F5] px-3.5 py-2 text-xs font-semibold text-[#1F2421] transition-all hover:border-[#4A6B53]/40 hover:bg-[#EDF3EE]/60 active:scale-[0.98] disabled:opacity-60 touch-manipulation"
                      >
                        {isTestingConnection ? (
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <Wifi className="h-3.5 w-3.5 text-[#4A6B53]" aria-hidden="true" />
                        )}
                        <span>Sprawdź połączenie</span>
                      </button>

                      {storedToken ? (
                        <button
                          type="button"
                          onClick={handleClearToken}
                          aria-label="Usuń zapisany token"
                          className="inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-xl border border-[#F2CED6] bg-[#FCF0F2] px-3 text-xs font-semibold text-[#A24156] transition-all hover:bg-[#F9E1E6] active:scale-[0.98] touch-manipulation"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>

                    {tokenFeedback ? (
                      <div
                        role="status"
                        className={`rounded-xl border px-3.5 py-2.5 text-xs font-medium leading-relaxed ${
                          tokenFeedback.type === 'success'
                            ? 'border-[#C9DBC9] bg-[#EDF3EE] text-[#3B5542]'
                            : 'border-[#F2CED6] bg-[#FCF0F2] text-[#A24156]'
                        }`}
                      >
                        {tokenFeedback.message}
                      </div>
                    ) : null}

                    <div className="rounded-xl bg-[#FAF8F5] p-3 text-[11px] leading-relaxed text-[#1F2421]/65">
                      <p className="font-semibold text-[#1F2421]/80">
                        Wymagane uprawnienia dla repozytorium{' '}
                        {GITHUB_CONFIG.owner}/{GITHUB_CONFIG.repo}:
                      </p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        <li>
                          <strong>Actions:</strong> Read and write (dodawanie i
                          usuwanie przepisów oraz śledzenie postępu)
                        </li>
                        <li>
                          <strong>Contents:</strong> Read-only (Instant Preview
                          nowych przepisów)
                        </li>
                      </ul>
                    </div>
                  </form>

                  {/* Magic Link Generator */}
                  <div className="space-y-3 rounded-2xl border border-[#EAE5DF] bg-white p-4 shadow-2xs">
                    <div className="flex items-center gap-2">
                      <Smartphone
                        className="h-4 w-4 text-[#C86D51]"
                        aria-hidden="true"
                      />
                      <h3 className="font-serif text-base font-bold text-[#1F2421]">
                        Parowanie iPhone’a (Magic Link)
                      </h3>
                    </div>

                    <p className="text-xs leading-relaxed text-[#1F2421]/65">
                      Wygeneruj jednorazowy link z tokenem i wyślij go na swój
                      telefon (np. przez iMessage, WhatsApp lub AirDrop).
                      Wystarczy kliknąć go w Safari, aby zapisać dostęp jednym
                      dotknięciem.
                    </p>

                    {magicLinkUrl ? (
                      <>
                        <div className="rounded-xl border border-[#EAE5DF] bg-[#FAF8F5] p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold tracking-wide text-[#1F2421]/55 uppercase">
                              Gotowy Magic Link
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setShowFullMagicLink((prev) => !prev)
                              }
                              className="cursor-pointer text-[11px] font-semibold text-[#4A6B53] hover:underline"
                            >
                              {showFullMagicLink ? 'Zamaskuj' : 'Pokaż cały'}
                            </button>
                          </div>
                          <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-[#1F2421]/80">
                            {showFullMagicLink
                              ? magicLinkUrl
                              : maskMagicLink(magicLinkUrl)}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={handleCopyMagicLink}
                            className={`inline-flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold transition-all active:scale-[0.98] touch-manipulation ${
                              magicLinkCopied
                                ? 'border-[#4A6B53] bg-[#EDF3EE] text-[#3B5542]'
                                : 'border-[#C86D51] bg-[#C86D51] text-white shadow-2xs hover:bg-[#B35B40]'
                            }`}
                          >
                            {magicLinkCopied ? (
                              <>
                                <Check className="h-4 w-4" aria-hidden="true" />
                                <span>Skopiowano Magic Link!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-4 w-4" aria-hidden="true" />
                                <span>Kopiuj Magic Link na telefon</span>
                              </>
                            )}
                          </button>

                          {canNativeShare ? (
                            <button
                              type="button"
                              onClick={handleShareMagicLink}
                              aria-label="Udostępnij Magic Link"
                              className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-[#EAE5DF] bg-[#FAF8F5] px-3.5 py-2 text-xs font-semibold text-[#1F2421] transition-all hover:border-[#4A6B53]/40 active:scale-[0.98] touch-manipulation"
                            >
                              <Share2 className="h-4 w-4 text-[#4A6B53]" aria-hidden="true" />
                              <span>Wyślij</span>
                            </button>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <div className="rounded-xl border border-dashed border-[#EAE5DF] bg-[#FAF8F5] p-3.5 text-center text-xs text-[#1F2421]/55">
                        Wpisz powyżej token GitHub, aby automatycznie wygenerować
                        Magic Link dla iPhone’a.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
