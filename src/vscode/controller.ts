/**
 * @file Orchestrates polling: credentials → usage endpoint → local fallback → status bar.
 */

import * as vscode from 'vscode';
import type { CredentialStore } from '../core/credentials';
import { UsageApiError } from '../core/errors';
import type { LocalUsageEstimator } from '../core/localUsage';
import { hasAnyWindow, type UsageApiClient } from '../core/usageApi';
import type { TokenwatchConfig, UsageState } from '../core/types';
import { CONFIG_SECTION, readConfig } from './config';
import type { UsageStatusBar } from './statusBar';

/** Collaborators of {@link UsageController}, injected so each can be replaced in tests. */
export interface UsageControllerDeps {
  readonly credentials: CredentialStore;
  readonly api: UsageApiClient;
  readonly localEstimator: LocalUsageEstimator;
  readonly statusBar: UsageStatusBar;
}

/**
 * Drives periodic refreshes and keeps the status bar in sync with settings.
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
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(private readonly deps: UsageControllerDeps) {
    this.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(CONFIG_SECTION)) this.applyConfig();
      }),
      vscode.window.onDidChangeWindowState((s) => {
        if (s.focused && this.isStale()) void this.refresh();
      }),
    );
  }

  /** Performs the first refresh and starts the polling timer. */
  start(): void {
    this.schedule();
    void this.refresh();
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

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    vscode.Disposable.from(...this.subscriptions).dispose();
  }

  private async doRefresh(): Promise<void> {
    this.setState(await this.computeState());
  }

  private async computeState(): Promise<UsageState> {
    const token = await this.deps.credentials.getAccessToken();
    if (!token) return { kind: 'noCredentials' };

    let reason: string;
    try {
      const snapshot = await this.deps.api.fetchUsage(token);
      if (hasAnyWindow(snapshot)) return { kind: 'live', snapshot, fetchedAt: new Date() };
      reason = 'usage endpoint returned an unrecognised response';
    } catch (err) {
      reason = describeFailure(err);
    }

    const estimate = await this.deps.localEstimator.estimateToday();
    return estimate ? { kind: 'fallback', estimate, reason } : { kind: 'error', message: reason };
  }

  private setState(state: UsageState): void {
    this.state = state;
    this.deps.statusBar.render(state, this.config);
  }

  private applyConfig(): void {
    this.config = readConfig();
    this.schedule();
    this.deps.statusBar.render(this.state, this.config);
  }

  private schedule(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (vscode.window.state.focused) void this.refresh();
    }, this.config.pollIntervalSeconds * 1_000);
  }

  private isStale(): boolean {
    return Date.now() - this.lastRefreshAt >= this.config.pollIntervalSeconds * 1_000;
  }
}

/** Turns a refresh failure into a short, token-free message for the tooltip. */
function describeFailure(err: unknown): string {
  if (err instanceof UsageApiError) {
    if (err.isAuthFailure) return 'login rejected — run `claude` to refresh it';
    if (err.status === 429) return 'rate-limited by the usage endpoint';
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
