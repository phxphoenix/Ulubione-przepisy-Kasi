import { afterEach, describe, expect, it, vi } from 'vitest';
import { withBase } from '../../src/utils/paths';

describe('withBase', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps external, protocol-relative, anchor, mailto, and tel URLs unchanged', () => {
    vi.stubEnv('BASE_URL', '/Ulubione-przepisy-Kasi/');
    expect(withBase('https://example.com/a.jpg')).toBe('https://example.com/a.jpg');
    expect(withBase('http://example.com/a.jpg')).toBe('http://example.com/a.jpg');
    expect(withBase('//cdn.example.com/a.jpg')).toBe('//cdn.example.com/a.jpg');
    expect(withBase('#skladniki')).toBe('#skladniki');
    expect(withBase('mailto:kasia@example.com')).toBe('mailto:kasia@example.com');
    expect(withBase('tel:+48123456789')).toBe('tel:+48123456789');
  });

  it('resolves internal paths against root BASE_URL', () => {
    vi.stubEnv('BASE_URL', '/');
    expect(withBase('/')).toBe('/');
    expect(withBase('')).toBe('/');
    expect(withBase('/przepis/rigatoni')).toBe('/przepis/rigatoni');
    expect(withBase('images/recipes/a.jpg')).toBe('/images/recipes/a.jpg');
  });

  it('resolves internal paths against GitHub Pages subpath BASE_URL', () => {
    vi.stubEnv('BASE_URL', '/Ulubione-przepisy-Kasi');
    expect(withBase('/')).toBe('/Ulubione-przepisy-Kasi/');
    expect(withBase('')).toBe('/Ulubione-przepisy-Kasi/');
    expect(withBase('/przepis/nalesniki')).toBe('/Ulubione-przepisy-Kasi/przepis/nalesniki');
    expect(withBase('favicon.svg')).toBe('/Ulubione-przepisy-Kasi/favicon.svg');
  });
});
