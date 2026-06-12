import { afterEach, describe, expect, it } from 'vitest';

import { parseDashboardUsage, resolveDashboardConfig } from './opencode-go-dashboard.js';

describe('parseDashboardUsage', () => {
  it('parses SolidJS hydration windows regardless of field order', () => {
    const html =
      'prefix rollingUsage:$R[12]={status:"ok",resetInSec:2520,usagePercent:65} ' +
      'weeklyUsage:$R[13]={resetInSec:259200,usagePercent:30,status:"ok"} ' +
      'monthlyUsage:$R[14]={usagePercent:12,resetInSec:1728000,status:"ok"} suffix';

    const parsed = parseDashboardUsage(html);

    expect(parsed).toEqual({
      rolling: { usagePercent: 65, resetInSec: 2520, status: 'ok' },
      weekly: { usagePercent: 30, resetInSec: 259200, status: 'ok' },
      monthly: { usagePercent: 12, resetInSec: 1728000, status: 'ok' }
    });
  });

  it('parses quoted JSON-style hydration and rate-limited status', () => {
    const html =
      '{"rollingUsage":{"usagePercent":100,"resetInSec":600,"status":"rate-limited"}}';

    const parsed = parseDashboardUsage(html);

    expect(parsed?.rolling).toEqual({
      usagePercent: 100,
      resetInSec: 600,
      status: 'rate-limited'
    });
    expect(parsed?.weekly).toBeUndefined();
  });

  it('returns null when no windows are present', () => {
    expect(parseDashboardUsage('<html>no usage here</html>')).toBeNull();
    expect(parseDashboardUsage('')).toBeNull();
    expect(parseDashboardUsage(null)).toBeNull();
  });
});

describe('resolveDashboardConfig', () => {
  afterEach(() => {
    delete process.env.OPENCODE_GO_WORKSPACE_ID;
    delete process.env.OPENCODE_GO_AUTH_COOKIE;
  });

  it('resolves from environment variables', () => {
    process.env.OPENCODE_GO_WORKSPACE_ID = 'wrk_abc';
    process.env.OPENCODE_GO_AUTH_COOKIE = 'cookie-value';

    expect(resolveDashboardConfig()).toEqual({
      workspaceId: 'wrk_abc',
      authCookie: 'cookie-value',
      source: 'env'
    });
  });

  it('requires both workspace id and cookie', () => {
    process.env.OPENCODE_GO_WORKSPACE_ID = 'wrk_abc';
    // No cookie set, and no config files in the test home dir.
    expect(resolveDashboardConfig()).toBeNull();
  });
});
