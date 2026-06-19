import React, { useMemo, useEffect } from 'react';
import type { SupportedLanguages } from '@pierre/diffs';
import { WorkerPoolManager } from '@pierre/diffs/worker';

import { useOptionalThemeSystem } from './useThemeSystem';
import { workerFactory } from '@/lib/diff/workerFactory';
import { ensurePierreThemeRegistered } from '@/lib/shiki/appThemeRegistry';
import { getDefaultTheme } from '@/lib/theme/themes';
// NOTE: keep provider lightweight; avoid main-thread diff parsing here.

// Preload common languages for faster initial diff rendering
const PRELOAD_LANGS: SupportedLanguages[] = [
  // Keep small; workers load others on-demand.
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'json',
  'markdown',
];

interface DiffWorkerProviderProps {
  children: React.ReactNode;
}

type WorkerPoolStyle = 'unified' | 'split';

const WORKER_POOL_CONFIG: Record<WorkerPoolStyle, { poolSize: number; totalASTLRUCacheSize: number; lineDiffType: 'none' | 'word-alt' }> = {
  unified: {
    poolSize: 1,
    totalASTLRUCacheSize: 24,
    lineDiffType: 'none',
  },
  split: {
    poolSize: 2,
    totalASTLRUCacheSize: 56,
    lineDiffType: 'word-alt',
  },
};

let unifiedWorkerPool: WorkerPoolManager | undefined;
let splitWorkerPool: WorkerPoolManager | undefined;

// The render theme the next lazily-created pool should start with. Seeded by
// DiffWorkerProvider's effect so a pool created on first diff use already
// matches the app theme (instead of the Pierre built-in fallback).
let currentRenderTheme: { light: string; dark: string } = {
  light: 'pierre-light',
  dark: 'pierre-dark',
};

const createWorkerPool = (style: WorkerPoolStyle) => {
  const config = WORKER_POOL_CONFIG[style];
  const pool = new WorkerPoolManager(
    {
      workerFactory,
      poolSize: config.poolSize,
      totalASTLRUCacheSize: config.totalASTLRUCacheSize,
    },
    {
      theme: currentRenderTheme,
      langs: PRELOAD_LANGS,
      lineDiffType: config.lineDiffType,
      preferredHighlighter: 'shiki-wasm',
    }
  );
  void pool.initialize();
  return pool;
};

// Apply the render theme WITHOUT forcing pool creation: update the seed for
// future pools and push render options to any pool that already exists. This
// lets us drop the eager warmup (which spun up both worker pools + shiki-wasm
// at app mount) and defer pool creation to the first actual diff render.
const applyRenderThemeToExistingPools = (renderTheme: { light: string; dark: string }) => {
  currentRenderTheme = renderTheme;
  if (unifiedWorkerPool) {
    void unifiedWorkerPool.setRenderOptions({
      theme: renderTheme,
      lineDiffType: WORKER_POOL_CONFIG.unified.lineDiffType,
    });
  }
  if (splitWorkerPool) {
    void splitWorkerPool.setRenderOptions({
      theme: renderTheme,
      lineDiffType: WORKER_POOL_CONFIG.split.lineDiffType,
    });
  }
};

const getWorkerPool = (style: WorkerPoolStyle): WorkerPoolManager | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  if (style === 'split') {
    splitWorkerPool ??= createWorkerPool('split');
    return splitWorkerPool;
  }

  unifiedWorkerPool ??= createWorkerPool('unified');
  return unifiedWorkerPool;
};

const WorkerPoolThemeSync: React.FC<{
  children: React.ReactNode;
  renderTheme: { light: string; dark: string };
}> = ({ children, renderTheme }) => {
  useEffect(() => {
    // Does NOT create pools — only seeds the theme for future pools and
    // updates any already-created pool. Pools are created lazily on first diff.
    applyRenderThemeToExistingPools(renderTheme);
  }, [renderTheme]);

  return <>{children}</>;
};

export const DiffWorkerProvider: React.FC<DiffWorkerProviderProps> = ({ children }) => {
  const themeSystem = useOptionalThemeSystem();

  const fallbackLight = getDefaultTheme(false);
  const fallbackDark = getDefaultTheme(true);

  const lightThemeId = themeSystem?.lightThemeId ?? fallbackLight.metadata.id;
  const darkThemeId = themeSystem?.darkThemeId ?? fallbackDark.metadata.id;

  const lightTheme =
    themeSystem?.availableThemes.find((theme) => theme.metadata.id === lightThemeId) ??
    fallbackLight;
  const darkTheme =
    themeSystem?.availableThemes.find((theme) => theme.metadata.id === darkThemeId) ??
    fallbackDark;

  ensurePierreThemeRegistered(lightTheme);
  ensurePierreThemeRegistered(darkTheme);

  const renderTheme = useMemo(
    () => ({
      light: lightTheme.metadata.id,
      dark: darkTheme.metadata.id,
    }),
    [darkTheme.metadata.id, lightTheme.metadata.id],
  );

  return (
    <WorkerPoolThemeSync renderTheme={renderTheme}>
      {children}
    </WorkerPoolThemeSync>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useWorkerPool = (style: WorkerPoolStyle = 'unified'): WorkerPoolManager | undefined => {
  return useMemo(() => getWorkerPool(style), [style]);
};
