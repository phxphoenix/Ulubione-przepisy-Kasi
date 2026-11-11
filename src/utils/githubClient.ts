import { CATEGORY_NAMES, type RecipeCategory } from '../constants/categories';
import type {
  IngredientGroup,
  IngredientItem,
  Recipe,
  RecipeDifficulty,
  RecipeImage,
  RecipeStep,
  RecipeVideo,
  VideoPlatform,
} from '../types/recipe';
import { withBase } from './paths';

const DIFFICULTY_VALUES: readonly RecipeDifficulty[] = [
  'Łatwy',
  'Średni',
  'Wymagający',
];
const VIDEO_PLATFORM_VALUES: readonly VideoPlatform[] = [
  'youtube',
  'instagram',
  'tiktok',
  'mp4',
];

export const GITHUB_CONFIG = {
  owner: 'phxphoenix',
  repo: 'Ulubione-przepisy-Kasi',
  workflowFile: 'add-recipe.yml',
  deleteWorkflowFile: 'delete-recipe.yml',
  branch: 'main',
  tokenStorageKey: 'kasia_gh_token',
  recipesDirPath: 'src/content/recipes',
} as const;

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const GITHUB_ACCEPT_V3 = 'application/vnd.github.v3+json';

export const TOKEN_CHANGED_EVENT = 'kasia:token-changed';

export type GitHubApiErrorCode =
  | 'NO_TOKEN'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'RATE_LIMIT'
  | 'NETWORK'
  | 'UNKNOWN';

export class GitHubApiError extends Error {
  readonly code: GitHubApiErrorCode;
  readonly status?: number;
  readonly details?: string;

  constructor(
    message: string,
    code: GitHubApiErrorCode,
    status?: number,
    details?: string
  ) {
    super(message);
    this.name = 'GitHubApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface GitHubWorkflowRun {
  id: number;
  name: string | null;
  path?: string;
  status: string | null;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  run_started_at?: string | null;
  html_url: string;
}

export interface GitHubWorkflowJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  html_url?: string | null;
}

export interface GitHubContentEntry {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  download_url: string | null;
  content?: string;
  encoding?: string;
}

export interface MagicLinkConsumeResult {
  paired: boolean;
  token?: string;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function notifyTokenChanged(): void {
  if (!isBrowser()) {
    return;
  }
  window.dispatchEvent(new CustomEvent(TOKEN_CHANGED_EVENT));
}

export function getGitHubToken(): string | null {
  if (!isBrowser()) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(GITHUB_CONFIG.tokenStorageKey);
    const trimmed = raw?.trim() ?? '';
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export function setGitHubToken(token: string): string {
  const trimmed = token.trim();
  if (!isBrowser()) {
    return trimmed;
  }
  try {
    if (!trimmed) {
      window.localStorage.removeItem(GITHUB_CONFIG.tokenStorageKey);
    } else {
      window.localStorage.setItem(GITHUB_CONFIG.tokenStorageKey, trimmed);
    }
    notifyTokenChanged();
  } catch {
    // Ignore storage errors in restricted private browsing contexts
  }
  return trimmed;
}

export function removeGitHubToken(): void {
  if (!isBrowser()) {
    return;
  }
  try {
    window.localStorage.removeItem(GITHUB_CONFIG.tokenStorageKey);
    notifyTokenChanged();
  } catch {
    // Ignore storage errors
  }
}

export function hasGitHubToken(): boolean {
  return getGitHubToken() !== null;
}

/**
 * Checks URL query (?token=...) and hash (#token=...) on startup.
 * Persists any discovered token to localStorage, cleans the URL via replaceState,
 * and returns whether a device pairing just occurred.
 */
export function consumeMagicLinkFromUrl(): MagicLinkConsumeResult {
  if (!isBrowser()) {
    return { paired: false };
  }

  try {
    const currentUrl = new URL(window.location.href);
    let extractedToken: string | null = null;
    let urlChanged = false;

    const queryToken = currentUrl.searchParams.get('token')?.trim();
    if (queryToken) {
      extractedToken = queryToken;
      currentUrl.searchParams.delete('token');
      urlChanged = true;
    }

    if (currentUrl.hash && currentUrl.hash.length > 1) {
      const rawHash = currentUrl.hash.slice(1);
      const hashBody = rawHash.startsWith('?') ? rawHash.slice(1) : rawHash;
      if (hashBody.includes('token=')) {
        const hashParams = new URLSearchParams(hashBody);
        const hashToken = hashParams.get('token')?.trim();
        if (hashToken) {
          extractedToken = extractedToken ?? hashToken;
          hashParams.delete('token');
          const remainingHash = hashParams.toString();
          currentUrl.hash = remainingHash ? `#${remainingHash}` : '';
          urlChanged = true;
        }
      }
    }

    if (!extractedToken) {
      return { paired: false };
    }

    setGitHubToken(extractedToken);

    if (urlChanged) {
      const cleanUrl = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
      window.history.replaceState(window.history.state, '', cleanUrl || '/');
    }

    return { paired: true, token: extractedToken };
  } catch {
    return { paired: false };
  }
}

export function buildMagicLink(tokenOverride?: string): string {
  const token = (tokenOverride ?? getGitHubToken() ?? '').trim();
  if (!token) {
    return '';
  }

  const origin = isBrowser() ? window.location.origin : 'https://phxphoenix.github.io';
  const basePath = withBase('/');
  const baseUrl = new URL(basePath, origin).toString();
  return `${baseUrl}#token=${encodeURIComponent(token)}`;
}

export function validateRecipeUrl(rawUrl: string): {
  valid: boolean;
  normalizedUrl?: string;
  error?: string;
} {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return {
      valid: false,
      error: 'Wklej adres URL strony z przepisem.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      error:
        'Nieprawidłowy format adresu URL. Adres musi zaczynać się od https:// lub http://.',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      error: 'Obsługiwane są wyłącznie adresy http:// oraz https://.',
    };
  }

  const hostname = parsed.hostname;
  if (
    !hostname ||
    !hostname.includes('.') ||
    hostname.startsWith('.') ||
    hostname.endsWith('.')
  ) {
    return {
      valid: false,
      error: 'Podaj pełny adres strony internetowej (np. https://www.kwestiasmaku.com/...).',
    };
  }

  return {
    valid: true,
    normalizedUrl: parsed.toString(),
  };
}

function repoApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${GITHUB_API_BASE}/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}${cleanPath}`;
}

function appendCacheBust(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}_t=${Date.now()}`;
}

function buildHeaders(
  token: string | null,
  options?: { includeJsonContentType?: boolean }
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: GITHUB_ACCEPT_V3,
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (options?.includeJsonContentType) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

function requireToken(tokenOverride?: string): string {
  const token = (tokenOverride ?? getGitHubToken() ?? '').trim();
  if (!token) {
    throw new GitHubApiError(
      'Brak tokenu GitHub. Wklej Fine-Grained Personal Access Token w ustawieniach lub otwórz Magic Link na tym urządzeniu.',
      'NO_TOKEN',
      401
    );
  }
  return token;
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { message?: string };
    if (typeof data?.message === 'string' && data.message.trim()) {
      return data.message.trim();
    }
  } catch {
    // Response may have no JSON body
  }
  return response.statusText || `HTTP ${response.status}`;
}

async function mapGitHubResponseError(
  response: Response,
  workflowFile: string = GITHUB_CONFIG.workflowFile
): Promise<GitHubApiError> {
  const details = await parseErrorMessage(response);
  const status = response.status;

  if (status === 401) {
    return new GitHubApiError(
      'Błąd autoryzacji (401): Token GitHub jest nieprawidłowy lub wygasł. Zaktualizuj go w ustawieniach.',
      'UNAUTHORIZED',
      status,
      details
    );
  }

  if (status === 403) {
    const remaining = response.headers.get('X-RateLimit-Remaining');
    if (remaining === '0') {
      return new GitHubApiError(
        'Przekroczono limit zapytań GitHub API. Odczekaj chwilę i spróbuj ponownie.',
        'RATE_LIMIT',
        status,
        details
      );
    }
    return new GitHubApiError(
      'Brak uprawnień (403). Upewnij się, że token ma dostęp do repozytorium phxphoenix/Ulubione-przepisy-Kasi (Actions: Read & Write, Contents: Read).',
      'FORBIDDEN',
      status,
      details
    );
  }

  if (status === 404) {
    return new GitHubApiError(
      `Nie znaleziono zasobu w repozytorium ${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo} (404). Sprawdź dostęp tokenu i istnienie pliku workflow ${workflowFile}.`,
      'NOT_FOUND',
      status,
      details
    );
  }

  if (status === 422) {
    return new GitHubApiError(
      `GitHub odrzucił żądanie (422): ${details}`,
      'VALIDATION',
      status,
      details
    );
  }

  return new GitHubApiError(
    `Błąd GitHub API (${status}): ${details}`,
    'UNKNOWN',
    status,
    details
  );
}

async function githubFetch(
  url: string,
  init: RequestInit
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new GitHubApiError(
      'Brak połączenia z GitHub API. Sprawdź dostęp do internetu i spróbuj ponownie.',
      'NETWORK',
      undefined,
      details
    );
  }
}

export async function testGitHubConnection(
  tokenOverride?: string
): Promise<{ ok: boolean; workflowName?: string }> {
  const token = requireToken(tokenOverride);
  const url = appendCacheBust(
    repoApiUrl(`/actions/workflows/${GITHUB_CONFIG.workflowFile}`)
  );

  const response = await githubFetch(url, {
    method: 'GET',
    headers: buildHeaders(token),
  });

  if (!response.ok) {
    throw await mapGitHubResponseError(response);
  }

  const data = (await response.json()) as { name?: string };
  return { ok: true, workflowName: data?.name };
}

export async function dispatchAddRecipeWorkflow(
  recipeUrl: string,
  tokenOverride?: string
): Promise<void> {
  const token = requireToken(tokenOverride);
  const url = repoApiUrl(
    `/actions/workflows/${GITHUB_CONFIG.workflowFile}/dispatches`
  );

  const response = await githubFetch(url, {
    method: 'POST',
    headers: buildHeaders(token, { includeJsonContentType: true }),
    body: JSON.stringify({
      ref: GITHUB_CONFIG.branch,
      inputs: {
        recipe_url: recipeUrl,
      },
    }),
  });

  if (!response.ok) {
    throw await mapGitHubResponseError(response);
  }
}

export async function dispatchDeleteRecipeWorkflow(
  recipeSlug: string,
  tokenOverride?: string
): Promise<void> {
  const trimmedSlug = recipeSlug.trim();
  if (!trimmedSlug) {
    throw new GitHubApiError(
      'Nieprawidłowy identyfikator przepisu do usunięcia.',
      'VALIDATION'
    );
  }

  const token = requireToken(tokenOverride);
  const url = repoApiUrl(
    `/actions/workflows/${GITHUB_CONFIG.deleteWorkflowFile}/dispatches`
  );

  const response = await githubFetch(url, {
    method: 'POST',
    headers: buildHeaders(token, { includeJsonContentType: true }),
    body: JSON.stringify({
      ref: GITHUB_CONFIG.branch,
      inputs: {
        recipe_slug: trimmedSlug,
      },
    }),
  });

  if (!response.ok) {
    throw await mapGitHubResponseError(
      response,
      GITHUB_CONFIG.deleteWorkflowFile
    );
  }
}

export async function fetchWorkflowDispatchRuns(
  perPage = 3,
  tokenOverride?: string
): Promise<GitHubWorkflowRun[]> {
  const token = requireToken(tokenOverride);
  const url = appendCacheBust(
    repoApiUrl(
      `/actions/workflows/${GITHUB_CONFIG.workflowFile}/runs?event=workflow_dispatch&per_page=${perPage}`
    )
  );

  const response = await githubFetch(url, {
    method: 'GET',
    headers: buildHeaders(token),
  });

  if (!response.ok) {
    throw await mapGitHubResponseError(response);
  }

  const data = (await response.json()) as {
    workflow_runs?: GitHubWorkflowRun[];
  };
  return Array.isArray(data?.workflow_runs) ? data.workflow_runs : [];
}

export async function fetchWorkflowRunById(
  runId: number,
  tokenOverride?: string
): Promise<GitHubWorkflowRun> {
  const token = requireToken(tokenOverride);
  const url = appendCacheBust(repoApiUrl(`/actions/runs/${runId}`));

  const response = await githubFetch(url, {
    method: 'GET',
    headers: buildHeaders(token),
  });

  if (!response.ok) {
    throw await mapGitHubResponseError(response);
  }

  return (await response.json()) as GitHubWorkflowRun;
}

export async function fetchWorkflowRunJobs(
  runId: number,
  tokenOverride?: string
): Promise<GitHubWorkflowJob[]> {
  const token = requireToken(tokenOverride);
  const url = appendCacheBust(repoApiUrl(`/actions/runs/${runId}/jobs`));

  const response = await githubFetch(url, {
    method: 'GET',
    headers: buildHeaders(token),
  });

  if (!response.ok) {
    throw await mapGitHubResponseError(response);
  }

  const data = (await response.json()) as { jobs?: GitHubWorkflowJob[] };
  return Array.isArray(data?.jobs) ? data.jobs : [];
}

async function fetchContentsWithPublicFallback(
  endpointUrl: string,
  token: string | null
): Promise<Response> {
  const response = await githubFetch(endpointUrl, {
    method: 'GET',
    headers: buildHeaders(token),
  });

  // If a Fine-Grained PAT only has Actions permission on a public repo,
  // sending Authorization can yield 403 while unauthenticated read succeeds.
  if (response.status === 403 && token) {
    const publicResponse = await githubFetch(appendCacheBust(endpointUrl), {
      method: 'GET',
      headers: buildHeaders(null),
    });
    if (publicResponse.ok) {
      return publicResponse;
    }
  }

  return response;
}

export async function fetchRecipeDirectoryFiles(
  tokenOverride?: string
): Promise<GitHubContentEntry[]> {
  const token = (tokenOverride ?? getGitHubToken())?.trim() || null;
  const url = appendCacheBust(
    repoApiUrl(
      `/contents/${GITHUB_CONFIG.recipesDirPath}?ref=${encodeURIComponent(
        GITHUB_CONFIG.branch
      )}`
    )
  );

  const response = await fetchContentsWithPublicFallback(url, token);
  if (!response.ok) {
    throw await mapGitHubResponseError(response);
  }

  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    return [];
  }

  return (data as GitHubContentEntry[]).filter(
    (entry) => entry.type === 'file' && entry.name.toLowerCase().endsWith('.json')
  );
}

function decodeBase64Utf8(base64: string): string {
  const normalized = base64.replace(/\s+/g, '');
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

export async function fetchRecipeJsonFile(
  filePathOrName: string,
  tokenOverride?: string
): Promise<Recipe> {
  const token = (tokenOverride ?? getGitHubToken())?.trim() || null;
  const fullPath = filePathOrName.includes('/')
    ? filePathOrName
    : `${GITHUB_CONFIG.recipesDirPath}/${filePathOrName}`;

  const encodedPath = fullPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  const url = appendCacheBust(
    repoApiUrl(
      `/contents/${encodedPath}?ref=${encodeURIComponent(GITHUB_CONFIG.branch)}`
    )
  );

  const response = await fetchContentsWithPublicFallback(url, token);
  if (!response.ok) {
    throw await mapGitHubResponseError(response);
  }

  const entry = (await response.json()) as GitHubContentEntry;
  let jsonText = '';

  if (typeof entry.content === 'string' && entry.content.trim().length > 0) {
    jsonText = decodeBase64Utf8(entry.content);
  } else if (entry.download_url) {
    const rawResponse = await githubFetch(appendCacheBust(entry.download_url), {
      method: 'GET',
    });
    if (!rawResponse.ok) {
      throw await mapGitHubResponseError(rawResponse);
    }
    jsonText = await rawResponse.text();
  } else {
    throw new GitHubApiError(
      'Pobrany plik przepisu z GitHub nie zawiera treści.',
      'UNKNOWN'
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new GitHubApiError(
      'Plik przepisu pobrany z GitHub ma niepoprawny format JSON.',
      'VALIDATION'
    );
  }

  return normalizeRecipePayload(parsed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function asPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function asNonNegativeInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

function normalizeCategory(value: unknown): RecipeCategory {
  const str = asNonEmptyString(value);
  if (str && (CATEGORY_NAMES as readonly string[]).includes(str)) {
    return str as RecipeCategory;
  }
  return 'Dania główne';
}

function normalizeDifficulty(value: unknown): RecipeDifficulty {
  const str = asNonEmptyString(value);
  if (str && (DIFFICULTY_VALUES as readonly string[]).includes(str)) {
    return str as RecipeDifficulty;
  }
  return 'Średni';
}

export function normalizeRecipePayload(raw: unknown): Recipe {
  if (!isRecord(raw)) {
    throw new GitHubApiError(
      'Nieprawidłowa struktura przepisu JSON.',
      'VALIDATION'
    );
  }

  const slug = asNonEmptyString(raw.slug) ?? asNonEmptyString(raw.id);
  const title = asNonEmptyString(raw.title);
  if (!slug || !title) {
    throw new GitHubApiError(
      'Przepis JSON nie zawiera wymaganych pól (slug lub title).',
      'VALIDATION'
    );
  }

  const rawImages = Array.isArray(raw.images) ? raw.images : [];
  const images: RecipeImage[] = rawImages
    .filter(isRecord)
    .map((img) => ({
      url: asNonEmptyString(img.url) ?? '',
      caption: asNonEmptyString(img.caption),
      isMain: typeof img.isMain === 'boolean' ? img.isMain : undefined,
    }))
    .filter((img) => img.url.length > 0);

  if (images.length === 0) {
    images.push({
      url: '/favicon.svg',
      caption: title,
      isMain: true,
    });
  }

  const rawVideos = Array.isArray(raw.videos) ? raw.videos : [];
  const videos: RecipeVideo[] = rawVideos
    .filter(isRecord)
    .map((vid) => {
      const platformRaw = asNonEmptyString(vid.platform);
      const platform: VideoPlatform =
        platformRaw &&
        (VIDEO_PLATFORM_VALUES as readonly string[]).includes(platformRaw)
          ? (platformRaw as VideoPlatform)
          : 'youtube';
      return {
        url: asNonEmptyString(vid.url) ?? '',
        platform,
        embedUrl: asNonEmptyString(vid.embedUrl) ?? asNonEmptyString(vid.url) ?? '',
        title: asNonEmptyString(vid.title),
      };
    })
    .filter((vid) => vid.url.length > 0 && vid.embedUrl.length > 0);

  const rawGroups = Array.isArray(raw.ingredientGroups)
    ? raw.ingredientGroups
    : [];
  const ingredientGroups: IngredientGroup[] = rawGroups
    .filter(isRecord)
    .map((group) => {
      const rawItems = Array.isArray(group.items) ? group.items : [];
      const items: IngredientItem[] = rawItems
        .filter(isRecord)
        .map((item) => ({
          name: asNonEmptyString(item.name) ?? '',
          amount:
            typeof item.amount === 'number' &&
            Number.isFinite(item.amount) &&
            item.amount >= 0
              ? item.amount
              : item.amount === null
                ? null
                : undefined,
          unit: asNonEmptyString(item.unit),
          notes: asNonEmptyString(item.notes),
        }))
        .filter((item) => item.name.length > 0);

      return {
        groupName: asNonEmptyString(group.groupName),
        items,
      };
    })
    .filter((group) => group.items.length > 0);

  const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
  const steps: RecipeStep[] = rawSteps
    .filter(isRecord)
    .map((step, index) => ({
      stepNumber:
        typeof step.stepNumber === 'number' &&
        Number.isInteger(step.stepNumber) &&
        step.stepNumber > 0
          ? step.stepNumber
          : index + 1,
      title: asNonEmptyString(step.title),
      instruction: asNonEmptyString(step.instruction) ?? '',
      tip: asNonEmptyString(step.tip),
      imageUrl: asNonEmptyString(step.imageUrl),
    }))
    .filter((step) => step.instruction.length > 0);

  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .map((tag) => asNonEmptyString(tag))
        .filter((tag): tag is string => Boolean(tag))
    : [];

  const chefTips = Array.isArray(raw.chefTips)
    ? raw.chefTips
        .map((tip) => asNonEmptyString(tip))
        .filter((tip): tip is string => Boolean(tip))
    : [];

  const sourceUrl = asNonEmptyString(raw.sourceUrl) ?? 'https://github.com';
  let sourceDomain = asNonEmptyString(raw.sourceDomain);
  if (!sourceDomain) {
    try {
      sourceDomain = new URL(sourceUrl).hostname.replace(/^www\./, '');
    } catch {
      sourceDomain = 'przepis';
    }
  }

  const createdAtRaw = asNonEmptyString(raw.createdAt);
  const createdAt =
    createdAtRaw && !Number.isNaN(Date.parse(createdAtRaw))
      ? createdAtRaw
      : new Date().toISOString();

  return {
    id: asNonEmptyString(raw.id) ?? slug,
    slug,
    title,
    summary: asNonEmptyString(raw.summary) ?? title,
    category: normalizeCategory(raw.category),
    tags,
    prepTimeMinutes: asNonNegativeInt(raw.prepTimeMinutes),
    cookTimeMinutes: asNonNegativeInt(raw.cookTimeMinutes),
    totalTimeMinutes: Math.round(asPositiveNumber(raw.totalTimeMinutes, 30)),
    servings: asPositiveNumber(raw.servings, 4),
    difficulty: normalizeDifficulty(raw.difficulty),
    images,
    videos,
    ingredientGroups:
      ingredientGroups.length > 0
        ? ingredientGroups
        : [{ items: [{ name: 'Składniki dostępne w źródle przepisu' }] }],
    steps:
      steps.length > 0
        ? steps
        : [{ stepNumber: 1, instruction: 'Szczegóły przygotowania dostępne pod linkiem źródłowym.' }],
    chefTips,
    sourceUrl,
    sourceDomain,
    originalLanguage: asNonEmptyString(raw.originalLanguage) ?? 'pl',
    createdAt,
  };
}
