import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Point the `@opencode-ai/sdk/v2` alias at the browser-safe v2 client in this
// package's own node_modules. The SDK is a direct dependency of this package,
// so bun links it locally regardless of the workspace hoist layout — unlike the
// previous `../../node_modules/...` path, which only worked when the SDK was
// hoisted to the repo root.
const opencodeV2Client = path.resolve(__dirname, 'node_modules/@opencode-ai/sdk/dist/v2/client.js');

export default defineConfig(({ mode }) => ({
  root: path.resolve(__dirname, 'webview'),
  base: './',  // Use relative paths for VS Code webview
  plugins: [
    react({
      babel: {
        plugins: ['babel-plugin-react-compiler'],
      },
    }),
  ],
  resolve: {
    alias: [
      { find: '@opencode-ai/sdk/v2', replacement: opencodeV2Client },
      { find: '@openchamber/ui', replacement: path.resolve(__dirname, '../ui/src') },
      { find: '@vscode', replacement: path.resolve(__dirname, './webview') },
      { find: '@', replacement: path.resolve(__dirname, '../ui/src') },
    ],
  },
  worker: {
    format: 'es',
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
    'global': 'globalThis',
    '__OPENCHAMBER_WEBVIEW_BUILD_TIME__': JSON.stringify(new Date().toISOString()),
  },
  envPrefix: ['VITE_'],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    hmr: {
      host: 'localhost',
      protocol: 'ws',
      port: 5173,
    },
  },
  optimizeDeps: {
    include: ['@opencode-ai/sdk/v2'],
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/webview'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'webview/index.html'),
      external: ['node:child_process', 'node:fs', 'node:path', 'node:url'],
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
}));
