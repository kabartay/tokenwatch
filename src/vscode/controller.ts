/**
 * @file Schedules refreshes and keeps the status bar in sync with settings and focus.
 *
 * What to display is decided by {@link UsageService}; this class only decides *when*.
 */

import * as vscode from 'vscode';
import { formatDuration, summarizeState } from '../core/format';
import { hasAnyWindow, parseUsageResponse } from '../core/usageApi';
import type { UsageService } from '../core/usageService';
import type { TokenwatchConfig, UsageState } from '../core/types';

/** A rate-limited refresh keeps showing the last good numbers if they are newer than this. */
const KEEP_LAST_LIVE_MS = 30 * 60 * 1_000;

type LiveState = Extract<UsageState, { kind: 'live' }>;

/** `globalState` key: the last good response and the backoff deadline, kept across reloads. */
const PERSIST_KEY = 'tokenwatch.lastQuota';

/** What survives a reload. The raw body is stored, not the parsed snapshot, so Dates round-trip. */
interface PersistedQuota {
  readonly raw?: unknown;
  readonly fetchedAt?: string;
  readonly backoffUntil?: number;
}
import { CONFIG_SECTION, readConfig } from './config';
import type { UsageStatusBar } from './statusBar';

/** Collaborators of {@link UsageController}. */
export interface UsageControllerDeps {
  readonly service: UsageService;
  readonly statusBar: UsageStatusBar;
  /** Diagnostics sink; never receives the access token. */
  readonly log: vscode.LogOutputChannel;
  /**
   * Extension `globalState`. Holds the last response body (usage percentages and reset times,
   * never the token) and the backoff deadline, so a reload neither blanks the line nor sends a
   * request that the server would just rate-limit.
   */
  readonly storage: vscode.Memento;
}

/**
 * Drives periodic refreshes.
 *
 * Every VS Code window runs its own extension host, so unfocused windows skip their polls
 * and catch up when focused; with several windows open the endpoint is still hit roughly
 * once per interval.
 */
export class UsageController implements vscode.Disposable {
  private config: TokenwatchConfig = readConfig();
  private state: UsageState = { kind: 'loading' };
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight: Promise<void> | undefined;
  private lastRefreshAt = 0;
  /** Epoch ms before which polls are skipped, set after a 429. */
  private backoffUntil = 0;
  /** Last successful snapshot, shown in place of the fallback while rate-limited. */
  private lastLive: LiveState | undefined;
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(private readonly deps: UsageControllerDeps) {
    this.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(CONFIG_SECTION)) this.applyConfig();
      }),
      vscode.window.onDidChangeWindowState((s) => {
        if (s.focused && this.isStale() && this.isPastBackoff()) void this.refresh();
      }),
    );
  }

  /**
   * Restores the last numbers and backoff from before a reload, then starts polling.
   *
   * The first request is skipped while a backoff is still running or while the restored
   * numbers are newer than the poll interval.
   */
  start(): void {
    this.restore();
    this.schedule();
    if (this.isPastBackoff() && this.isStale()) void this.refresh();
  }

  /**
   * Refreshes now. Concurrent calls share the refresh already in progress.
   *
   * @returns A promise that settles once the status bar has been updated.
   */
  refresh(): Promise<void> {
    this.inFlight ??= this.doRefresh().finally(() => {
      this.inFlight = undefined;
      this.lastRefreshAt = Date.now();
    });
    return this.inFlight;
  }

  /**
   * Refreshes on explicit user request and shows the spinner while it runs.
   *
   * @param notify - Also report the outcome in a notification, so the palette command
   *   visibly does something even when the status bar item is out of view.
   */
  async refreshManually(notify: boolean): Promise<void> {
    if (!this.isPastBackoff()) {
      // Another request now would only draw another 429; say when the next one will go out.
      const wait = formatDuration(this.backoffUntil - Date.now());
      this.deps.log.info(`Manual refresh skipped: rate-limited, next attempt in ${wait}`);
      if (notify) {
        const message = `Tokenwatch: rate-limited by the usage endpoint; next attempt in ${wait}`;
        if ((await vscode.window.showWarningMessage(message, 'Show Log')) === 'Show Log') {
          this.deps.log.show();
        }
      }
      return;
    }
    this.deps.statusBar.setRefreshing(true);
    try {
      await this.refresh();
    } finally {
      this.deps.statusBar.setRefreshing(false);
    }
    if (!notify) return;

    const message = `Tokenwatch: ${summarizeState(this.state)}`;
    const choice =
      this.state.kind === 'live'
        ? await vscode.window.showInformationMessage(message, 'Show Log')
        : await vscode.window.showWarningMessage(message, 'Show Log');
    if (choice === 'Show Log') this.deps.log.show();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    vscode.Disposable.from(...this.subscriptions).dispose();
  }

  private async doRefresh(): Promise<void> {
    let state: UsageState;
    try {
      state = await this.deps.service.resolve();
    } catch (err) {
      // The service handles expected failures; this guards against bugs leaving a stale item.
      state = { kind: 'error', message: err instanceof Error ? err.message : String(err) };
    }
    this.deps.log.info(summarizeState(state));
    this.applyBackoff(state);
    if (state.kind === 'live') this.lastLive = state;
    this.persist(state);
    this.state = this.keepLastLiveIfRateLimited(state);
    this.deps.statusBar.render(this.state, this.config);
  }

  /**
   * While rate-limited, recent real numbers beat today's local token count, so the last good
   * snapshot stays on screen (marked stale) instead of the fallback.
   */
  private restore(): void {
    const saved = this.deps.storage.get<PersistedQuota>(PERSIST_KEY);
    if (!saved) return;
    if (typeof saved.backoffUntil === 'number' && saved.backoffUntil > Date.now()) {
      this.backoffUntil = saved.backoffUntil;
      this.deps.log.info(`Restored backoff: next request in ${formatDuration(this.backoffUntil - Date.now())}`);
    }
    const fetchedAt = saved.fetchedAt ? new Date(saved.fetchedAt) : undefined;
    if (!fetchedAt || Number.isNaN(fetchedAt.getTime())) return;
    const age = Date.now() - fetchedAt.getTime();
    if (age > KEEP_LAST_LIVE_MS) return;
    const snapshot = parseUsageResponse(saved.raw);
    if (!hasAnyWindow(snapshot)) return;

    this.lastLive = { kind: 'live', snapshot, fetchedAt };
    this.lastRefreshAt = fetchedAt.getTime();
    const fresh = age < this.config.pollIntervalSeconds * 1_000;
    this.state = fresh ? this.lastLive : { ...this.lastLive, staleReason: 'from before reload' };
    this.deps.log.info(`Restored quota from ${fetchedAt.toISOString()}: ${summarizeState(this.state)}`);
    this.deps.statusBar.render(this.state, this.config);
  }

  private persist(state: UsageState): void {
    const saved: PersistedQuota = {
      raw: state.kind === 'live' ? state.snapshot.raw : this.lastLive?.snapshot.raw,
      fetchedAt: (state.kind === 'live' ? state.fetchedAt : this.lastLive?.fetchedAt)?.toISOString(),
      backoffUntil: this.backoffUntil,
    };
    void this.deps.storage.update(PERSIST_KEY, saved);
  }

  private keepLastLiveIfRateLimited(state: UsageState): UsageState {
    const rateLimited = (state.kind === 'fallback' || state.kind === 'error') && state.retryAfterSeconds;
    if (!rateLimited || !this.lastLive) return state;
    if (Date.now() - this.lastLive.fetchedAt.getTime() > KEEP_LAST_LIVE_MS) return state;
    return { ...this.lastLive, staleReason: 'rate-limited' };
  }

  /** Pushes out the next scheduled poll after a rate limit, instead of retrying on cadence. */
  private applyBackoff(state: UsageState): void {
    const retryAfterSeconds = (state.kind === 'fallback' || state.kind === 'error') && state.retryAfterSeconds;
    if (!retryAfterSeconds) return;
    this.backoffUntil = Date.now() + retryAfterSeconds * 1_000;
    this.deps.log.info(`Backing off polling for ${retryAfterSeconds}s after a rate limit`);
  }

  private applyConfig(): void {
    this.config = readConfig();
    this.schedule();
    this.deps.statusBar.render(this.state, this.config);
  }

  private schedule(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (vscode.window.state.focused && this.isPastBackoff()) void this.refresh();
    }, this.config.pollIntervalSeconds * 1_000);
  }

  private isStale(): boolean {
    return Date.now() - this.lastRefreshAt >= this.config.pollIntervalSeconds * 1_000;
  }

  private isPastBackoff(): boolean {
    return Date.now() >= this.backoffUntil;
  }
}
