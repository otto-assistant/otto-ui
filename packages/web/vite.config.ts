import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { VitePWA } from 'vite-plugin-pwa';
import { themeStoragePlugin } from '../../vite-theme-plugin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));
const pwaDevEnabled = process.env.OPENCHAMBER_DISABLE_PWA_DEV !== '1';
const reactScanToggle = (process.env.VITE_ENABLE_REACT_SCAN ?? '').toLowerCase();
const enableReactScan = reactScanToggle === '1' || reactScanToggle === 'true' || reactScanToggle === 'on' || reactScanToggle === 'yes';

const PLAYWRIGHT_STUB_PORT = Number.parseInt(process.env.PLAYWRIGHT_STUB_API_PORT ?? '0', 10) || undefined;
const backendPort = process.env.OPENCHAMBER_PORT || '3001';
const proxyBackendTarget = `http://127.0.0.1:${PLAYWRIGHT_STUB_PORT ?? backendPort}`;

/** Preserve the browser-visible Host (LAN IP/DNS + Vite port) on proxied dev requests so origin checks see `http://<lan>:5173` instead of the upstream `:3001` host-only. */
function attachForwardedDevHeaders(proxy: { on(event: string, listener: (...args: any[]) => void): void }) {
  const apply = (proxyReq: any, req: any) => {
    const incomingHost = req?.headers?.host;
    if (typeof incomingHost === 'string' && incomingHost.trim().length > 0 && !proxyReq?.getHeader?.('x-forwarded-host')) {
      proxyReq.setHeader('x-forwarded-host', incomingHost.trim());
    }

    const secure =
      typeof req?.socket !== 'undefined' && 'encrypted' in req.socket && Boolean((req.socket as { encrypted?: boolean }).encrypted);

    if (!proxyReq?.getHeader?.('x-forwarded-proto')) {
      proxyReq.setHeader('x-forwarded-proto', secure ? 'https' : 'http');
    }
  };

  proxy.on('proxyReq', (proxyReq, req: any, _res, _options) => {
    apply(proxyReq, req);
  });
  proxy.on('proxyReqWs', (proxyReq, req: any, _socket, _head, _options) => {
    apply(proxyReq, req);
  });
}

export default defineConfig({
  root: path.resolve(__dirname, '.'),
  plugins: [
    react({
      babel: {
        plugins: ['babel-plugin-react-compiler'],
      },
    }),
    {
      name: 'inject-react-scan-script',
      transformIndexHtml() {
        if (!enableReactScan) {
          return;
        }
        return [
          {
            tag: 'script',
            attrs: {
              crossorigin: 'anonymous',
              src: '//unpkg.com/react-scan/dist/auto.global.js',
            },
            injectTo: 'head-prepend',
          },
        ];
      },
    },
    themeStoragePlugin(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,ttf,otf,eot}'],
        // iOS Safari/PWA is much more reliable with a classic (non-module) SW bundle.
        rollupFormat: 'iife',
        // We already keep a custom manifest in index.html
        injectionPoint: undefined,
      },
      devOptions: {
        enabled: pwaDevEnabled,
        type: 'module',
      },
    }),
  ],
  resolve: {
    alias: [
      { find: '@opencode-ai/sdk/v2', replacement: path.resolve(__dirname, '../../node_modules/@opencode-ai/sdk/dist/v2/client.js') },
      { find: '@openchamber/ui', replacement: path.resolve(__dirname, '../ui/src') },
      { find: '@web', replacement: path.resolve(__dirname, './src') },
      { find: '@', replacement: path.resolve(__dirname, '../ui/src') },
    ],
  },
  worker: {
    format: 'es',
  },
  define: {
    'process.env': {},
    global: 'globalThis',
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  optimizeDeps: {
    include: ['@opencode-ai/sdk/v2'],
  },
  server: {
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/auth': {
        target: proxyBackendTarget,
        changeOrigin: true,
        configure(proxy) {
          attachForwardedDevHeaders(proxy);
        },
      },
      '/health': {
        target: proxyBackendTarget,
        changeOrigin: true,
        configure(proxy) {
          attachForwardedDevHeaders(proxy);
        },
      },
      '/api': {
        target: proxyBackendTarget,
        changeOrigin: true,
        ws: true,
        configure(proxy) {
          attachForwardedDevHeaders(proxy);
        },
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        miniChat: path.resolve(__dirname, 'mini-chat.html'),
      },
      external: ['node:child_process', 'node:fs', 'node:path', 'node:url'],
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          // Use the LAST occurrence of `node_modules/` so we extract the real
          // package name regardless of resolver layout. Bun stores packages
          // under `node_modules/.bun/<pkg>@<ver>/node_modules/<pkg>/...`,
          // and naïvely splitting on the first `node_modules/` makes every
          // dep look like the `.bun` "package" — collapsing the entire dep
          // graph into one 17 MB chunk and crippling first paint on mobile.
          const segments = id.split('node_modules/');
          const tail = segments[segments.length - 1];
          if (!tail) return undefined;

          const parts = tail.split('/');
          const packageName = tail.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];

          if (packageName === 'react' || packageName === 'react-dom' || packageName === 'scheduler') return 'vendor-react';
          if (packageName === 'zustand' || packageName === 'zustand/middleware') return 'vendor-zustand';

          if (packageName === '@opencode-ai/sdk') return 'vendor-opencode-sdk';
          if (packageName.includes('remark') || packageName.includes('rehype') || packageName === 'react-markdown' || packageName === 'micromark' || packageName.startsWith('micromark-')) return 'vendor-markdown';
          if (packageName === '@base-ui/react' || packageName.startsWith('@base-ui')) return 'vendor-base-ui';
          if (packageName.includes('react-syntax-highlighter') || packageName.includes('highlight.js') || packageName === 'lowlight') return 'vendor-syntax';
          if (packageName.startsWith('@radix-ui')) return 'vendor-radix';
          if (packageName === 'motion' || packageName === 'framer-motion') return 'vendor-motion';
          if (packageName === 'ghostty-web' || packageName.startsWith('xterm') || packageName === '@xterm') return 'vendor-terminal';

          const sanitized = packageName.replace(/^@/, '').replace(/\//g, '-');
          return `vendor-${sanitized}`;
        },
      },
    },
  },
});
