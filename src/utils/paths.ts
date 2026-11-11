/**
 * Helper to ensure internal paths and asset URLs correctly resolve
 * whether the app is running on GitHub Pages (with subpath /Ulubione-przepisy-Kasi/)
 * or at root (Vercel / localhost).
 */
export function withBase(path: string = '/'): string {
  if (!path) {
    const rawBase = import.meta.env.BASE_URL || '/';
    return rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
  }

  // External URLs, protocol-relative, anchors, mailto/tel
  if (
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('mailto:') ||
    path.startsWith('tel:') ||
    path.startsWith('//') ||
    path.startsWith('#')
  ) {
    return path;
  }

  const rawBase = import.meta.env.BASE_URL || '/';
  const normalizedBase = rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  // If path is root '/', return base with trailing slash or '/'
  if (cleanPath === '/') {
    return normalizedBase ? `${normalizedBase}/` : '/';
  }

  return `${normalizedBase}${cleanPath}`;
}
