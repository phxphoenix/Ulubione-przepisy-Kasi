// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import process from 'node:process';

const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

// https://astro.build/config
export default defineConfig({
  site: isGitHubActions ? 'https://phxphoenix.github.io' : undefined,
  base: isGitHubActions ? '/Ulubione-przepisy-Kasi' : '/',
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()]
  }
});
