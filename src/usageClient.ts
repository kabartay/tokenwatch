import * as https from 'https';

export interface UsageSnapshot {
  sessionPercent?: number;
  weeklyPercent?: number;
  sessionResetsAt?: string;
  weeklyResetsAt?: string;
  raw: unknown;
}

/**
 * This endpoint is undocumented. Its exact response shape has not been
 * verified against a live account, so parsing below is defensive: it scans
 * several plausible key names rather than assuming one fixed schema. If the
 * shape differs, `raw` is still returned so callers (and the status bar
 * tooltip) can show something useful for debugging.
 */
const CANDIDATE_SESSION_KEYS = ['session', 'five_hour', 'fiveHour', 'sessionUtilization'];
const CANDIDATE_WEEKLY_KEYS = ['week', 'weekly', 'weeklyUtilization'];
const CANDIDATE_PERCENT_KEYS = ['percent', 'percentage', 'utilization', 'utilizationPercent', 'used'];
const CANDIDATE_RESET_KEYS = ['resetsAt', 'reset_at', 'resetTime', 'reset_time'];

function findPercent(obj: Record<string, unknown>): number | undefined {
  for (const key of CANDIDATE_PERCENT_KEYS) {
    const v = obj[key];
    if (typeof v === 'number') return v;
  }
  return undefined;
}

function findReset(obj: Record<string, unknown>): string | undefined {
  for (const key of CANDIDATE_RESET_KEYS) {
    const v = obj[key];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

function findSection(
  root: Record<string, unknown>,
  candidates: string[]
): Record<string, unknown> | undefined {
  for (const key of candidates) {
    const v = root[key];
    if (v && typeof v === 'object') return v as Record<string, unknown>;
  }
  return undefined;
}

export function parseUsageResponse(body: unknown): UsageSnapshot {
  const snapshot: UsageSnapshot = { raw: body };
  if (!body || typeof body !== 'object') return snapshot;
  const root = body as Record<string, unknown>;

  const sessionSection = findSection(root, CANDIDATE_SESSION_KEYS);
  if (sessionSection) {
    snapshot.sessionPercent = findPercent(sessionSection);
    snapshot.sessionResetsAt = findReset(sessionSection);
  }

  const weeklySection = findSection(root, CANDIDATE_WEEKLY_KEYS);
  if (weeklySection) {
    snapshot.weeklyPercent = findPercent(weeklySection);
    snapshot.weeklyResetsAt = findReset(weeklySection);
  }

  return snapshot;
}

export function fetchUsage(accessToken: string): Promise<UsageSnapshot> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/api/oauth/usage',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        timeout: 10_000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(parseUsageResponse(JSON.parse(data)));
            } catch (e) {
              reject(new Error(`Failed to parse usage response: ${(e as Error).message}`));
            }
          } else {
            reject(new Error(`Usage endpoint returned HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Usage request timed out')));
    req.on('error', reject);
    req.end();
  });
}
