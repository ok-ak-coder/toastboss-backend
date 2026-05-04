import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cp, rm } from 'node:fs/promises';
import path from 'node:path';

const primaryOutDir = '../idtt-child/toastboss-app';
const secondaryOutDir = '../wordpress-child/toastboss-app';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'sync-toastboss-wordpress-build',
      apply: 'build',
      async closeBundle() {
        const sourceDir = path.resolve(__dirname, primaryOutDir);
        const targetDir = path.resolve(__dirname, secondaryOutDir);

        await rm(targetDir, { recursive: true, force: true });
        await cp(sourceDir, targetDir, { recursive: true });
      },
    },
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
  build: {
    outDir: primaryOutDir,
    emptyOutDir: true,
    manifest: true,
  },
});
