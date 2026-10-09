/**
 * Future Cloudflare Workers + D1 integration point.
 *
 * V2.0 intentionally runs with analytics disabled: no tracking requests,
 * visitor identifiers or misleading counters are created.
 */
export interface AnalyticsSummary {
  uv: number;
  pv: number;
  updatedAt?: string;
}

export interface AnalyticsClient {
  readonly enabled: boolean;
  recordVisit(): Promise<void>;
  getSummary(): Promise<AnalyticsSummary | null>;
}

export interface AnalyticsWorkerOptions {
  endpoint: string;
}

export function createDisabledAnalyticsClient(): AnalyticsClient {
  return {
    enabled: false,
    async recordVisit() {},
    async getSummary() {
      return null;
    },
  };
}

/**
 * Ready-to-wire adapter. Enable only after a Worker is deployed and
 * privacy/rate-limit behavior is reviewed. Do not place secret keys here.
 */
export function createWorkerAnalyticsClient({
  endpoint,
}: AnalyticsWorkerOptions): AnalyticsClient {
  const base = endpoint.replace(/\/$/, '');
  if (!/^https:\/\//.test(base)) {
    throw new Error('Analytics endpoint must use HTTPS');
  }

  return {
    enabled: true,
    async recordVisit() {
      const result = await fetch(`${base}/api/visit`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project: 'pattern-layout-studio' }),
      });
      if (!result.ok) throw new Error('Analytics write unavailable');
    },
    async getSummary() {
      const result = await fetch(`${base}/api/stats`, {
        credentials: 'omit',
      });
      if (!result.ok) throw new Error('Analytics read unavailable');
      const data: unknown = await result.json();
      if (
        !data ||
        typeof data !== 'object' ||
        !('uv' in data) ||
        !('pv' in data) ||
        typeof data.uv !== 'number' ||
        typeof data.pv !== 'number'
      ) {
        throw new Error('Invalid analytics response');
      }
      return { uv: data.uv, pv: data.pv };
    },
  };
}

export const analyticsClient: AnalyticsClient = createDisabledAnalyticsClient();
