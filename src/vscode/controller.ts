/**
 * @file Schedules refreshes and keeps the status bar in sync with settings and focus.
 *
 * What to display is decided by {@link UsageService}; this class only decides *when*.
 */

import * as vscode from 'vscode';
import { summarizeState } from '../core/format';
import type { UsageService } from '../core/usageService';
import type { TokenwatchConfig, UsageState } from '../core/types';
import { CONFIG_SECTION, readConfig } from './config';
import type { UsageStatusBar } from './statusBar';

/** Collaborators of {@link UsageController}. */
export interface UsageControllerDeps {
  readonly service: UsageService;
  readonly statusBar: UsageStatusBar;
  /** Diagnostics sink; never receives the access token. */
  readonly log: vscode.LogOutputChannel;
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
  /** Epoch ms before which scheduled polls are skipped, set after a 429. */
  private backoffUntil = 0;
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

  /**
   * Refreshes on explicit user request and shows the spinner while it runs.
   *
   * @param notify - Also report the outcome in a notification, so the palette command
   *   visibly does something even when the status bar item is out of view.
   */
  async refreshManually(notify: boolean): Promise<void> {
    this.deps.statusBar.render({ kind: 'loading' }, this.config);
    await this.refresh();
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
    this.state = state;
    this.deps.statusBar.render(state, this.config);
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
