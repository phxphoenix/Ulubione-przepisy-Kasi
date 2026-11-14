import { describe, expect, it, vi } from 'vitest';
import {
  buildMagicLink,
  consumeMagicLinkFromUrl,
  dispatchAddRecipeWorkflow,
  dispatchDeleteRecipeWorkflow,
  fetchRecipeDirectoryFiles,
  fetchRecipeJsonFile,
  GITHUB_CONFIG,
  GitHubApiError,
  getGitHubToken,
  hasGitHubToken,
  normalizeRecipePayload,
  removeGitHubToken,
  setGitHubToken,
  testGitHubConnection,
  TOKEN_CHANGED_EVENT,
  validateRecipeUrl,
} from '../../src/utils/githubClient';

describe('githubClient', () => {
  describe('token storage and Magic Link helpers', () => {
    it('stores, reads, removes token and emits TOKEN_CHANGED_EVENT', () => {
      const listener = vi.fn();
      window.addEventListener(TOKEN_CHANGED_EVENT, listener);

      expect(hasGitHubToken()).toBe(false);
      expect(getGitHubToken()).toBeNull();

      setGitHubToken('  ghp_secret_123  ');
      expect(getGitHubToken()).toBe('ghp_secret_123');
      expect(hasGitHubToken()).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);

      removeGitHubToken();
      expect(getGitHubToken()).toBeNull();
      expect(hasGitHubToken()).toBe(false);
      expect(listener).toHaveBeenCalledTimes(2);

      window.removeEventListener(TOKEN_CHANGED_EVENT, listener);
    });

    it('consumes token from URL hash and cleans URL via history.replaceState', () => {
      window.history.replaceState({}, '', '/Ulubione-przepisy-Kasi/#token=pat_hash_999&view=home');
      const result = consumeMagicLinkFromUrl();

      expect(result).toEqual({ paired: true, token: 'pat_hash_999' });
      expect(getGitHubToken()).toBe('pat_hash_999');
      expect(window.location.hash).not.toContain('pat_hash_999');
    });

    it('consumes token from URL query string and removes it', () => {
      window.history.replaceState({}, '', '/?token=pat_query_111&foo=bar');
      const result = consumeMagicLinkFromUrl();

      expect(result).toEqual({ paired: true, token: 'pat_query_111' });
      expect(getGitHubToken()).toBe('pat_query_111');
      expect(window.location.search).toBe('?foo=bar');
    });

    it('builds magic link using current token or override', () => {
      expect(buildMagicLink()).toBe('');
      const link = buildMagicLink('pat_abc+123');
      expect(link).toContain('#token=pat_abc%2B123');
    });
  });

  describe('validateRecipeUrl', () => {
    it('accepts valid http/https URLs and rejects invalid ones', () => {
      expect(validateRecipeUrl('')).toMatchObject({ valid: false });
      expect(validateRecipeUrl('kwestiasmaku.com/przepis')).toMatchObject({ valid: false });
      expect(validateRecipeUrl('ftp://example.com/recipe')).toMatchObject({ valid: false });
      expect(validateRecipeUrl('https://localhost/recipe')).toMatchObject({ valid: false });

      const valid = validateRecipeUrl('  https://www.kwestiasmaku.com/przepis/churros  ');
      expect(valid).toEqual({
        valid: true,
        normalizedUrl: 'https://www.kwestiasmaku.com/przepis/churros',
      });
    });
  });

  describe('normalizeRecipePayload', () => {
    it('normalizes partial payloads with safe defaults', () => {
      const normalized = normalizeRecipePayload({
        slug: 'test-danie',
        title: 'Testowe danie',
        category: 'Nieistniejąca kategoria',
        difficulty: 'Kosmiczny',
        sourceUrl: 'https://www.example.com/przepis',
      });

      expect(normalized.id).toBe('test-danie');
      expect(normalized.category).toBe('Dania główne');
      expect(normalized.difficulty).toBe('Średni');
      expect(normalized.sourceDomain).toBe('example.com');
      expect(normalized.images).toEqual([
        { url: '/favicon.svg', caption: 'Testowe danie', isMain: true },
      ]);
      expect(normalized.ingredientGroups.length).toBeGreaterThan(0);
      expect(normalized.steps.length).toBeGreaterThan(0);
    });

    it('throws GitHubApiError VALIDATION when slug or title is missing', () => {
      expect(() => normalizeRecipePayload({ title: 'Brak sluga' })).toThrow(GitHubApiError);
      try {
        normalizeRecipePayload([]);
      } catch (err) {
        expect(err).toBeInstanceOf(GitHubApiError);
        expect((err as GitHubApiError).code).toBe('VALIDATION');
      }
    });
  });

  describe('GitHub API requests', () => {
    it('throws NO_TOKEN before calling fetch when token is missing', async () => {
      await expect(testGitHubConnection()).rejects.toMatchObject({
        code: 'NO_TOKEN',
        status: 401,
      });
    });

    it('maps 200, 401, 403 rate limit, 404, and network failures accurately', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ name: 'Dodaj przepis z URL (AI Agent)' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      await expect(testGitHubConnection('tok')).resolves.toEqual({
        ok: true,
        workflowName: 'Dodaj przepis z URL (AI Agent)',
      });

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 })
      );
      await expect(testGitHubConnection('tok')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
          status: 403,
          headers: { 'X-RateLimit-Remaining': '0' },
        })
      );
      await expect(testGitHubConnection('tok')).rejects.toMatchObject({ code: 'RATE_LIMIT' });

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
      );
      await expect(testGitHubConnection('tok')).rejects.toMatchObject({ code: 'NOT_FOUND' });

      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await expect(testGitHubConnection('tok')).rejects.toMatchObject({ code: 'NETWORK' });
    });

    it('dispatches add and delete workflows with expected payloads', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
      vi.stubGlobal('fetch', fetchMock);

      await dispatchAddRecipeWorkflow('https://example.com/przepis', 'tok_1');
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.stringContaining(`/actions/workflows/${GITHUB_CONFIG.workflowFile}/dispatches`),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            ref: GITHUB_CONFIG.branch,
            inputs: { recipe_url: 'https://example.com/przepis' },
          }),
        })
      );

      await expect(dispatchDeleteRecipeWorkflow('   ', 'tok_1')).rejects.toMatchObject({
        code: 'VALIDATION',
      });

      await dispatchDeleteRecipeWorkflow('rigatoni-alla-vodka', 'tok_1');
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.stringContaining(
          `/actions/workflows/${GITHUB_CONFIG.deleteWorkflowFile}/dispatches`
        ),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            ref: GITHUB_CONFIG.branch,
            inputs: { recipe_slug: 'rigatoni-alla-vodka' },
          }),
        })
      );
    });

    it('falls back to unauthenticated read on 403 and decodes base64 UTF-8 JSON recipes', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      // First call with token returns 403, fallback without token returns directory list
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              { name: '.gitkeep', path: 'src/content/recipes/.gitkeep', sha: '1', size: 0, type: 'file', download_url: null },
              { name: 'żurek.json', path: 'src/content/recipes/żurek.json', sha: '2', size: 120, type: 'file', download_url: null },
            ]),
            { status: 200 }
          )
        );

      const files = await fetchRecipeDirectoryFiles('limited_tok');
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('żurek.json');

      const recipeObj = {
        slug: 'zurek-staropolski',
        title: 'Żurek staropolski z białą kiełbasą',
        category: 'Zupy',
        totalTimeMinutes: 60,
        servings: 4,
        difficulty: 'Średni',
        images: [{ url: 'https://example.com/zurek.jpg', isMain: true }],
        ingredientGroups: [{ items: [{ name: 'Zakwas żytni', amount: 500, unit: 'ml' }] }],
        steps: [{ stepNumber: 1, instruction: 'Zagotuj wywar.' }],
        sourceUrl: 'https://example.com/zurek',
        createdAt: '2026-11-12T12:00:00.000Z',
      };
      const utf8Bytes = new TextEncoder().encode(JSON.stringify(recipeObj));
      const base64 = btoa(String.fromCharCode(...utf8Bytes));

      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            name: 'zurek-staropolski.json',
            path: 'src/content/recipes/zurek-staropolski.json',
            sha: 'abc',
            size: 300,
            type: 'file',
            download_url: null,
            content: base64,
            encoding: 'base64',
          }),
          { status: 200 }
        )
      );

      const loaded = await fetchRecipeJsonFile('zurek-staropolski.json');
      expect(loaded.title).toBe('Żurek staropolski z białą kiełbasą');
      expect(loaded.category).toBe('Zupy');
    });
  });
});
