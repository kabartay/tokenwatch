/**
 * @file Wires quota refreshes to VS Code: timers, window focus, settings and notifications.
 *
 * What to show comes from {@link UsageService}; whether a request may go out, and what to
 * display while it can't, comes from {@link RefreshPolicy}. This class only connects them to
 * editor events.
 */

import * as vscode from 'vscode';
import type { RefreshPolicy } from '../application/refreshPolicy';
import type { UsageService } from '../application/usageService';
import { formatDuration, summarizeState } from '../domain/format';
import type { TokenwatchConfig, UsageState } from '../domain/types';
import { CONFIG_SECTION, readConfig } from './config';
import type { UsageStatusBar } from './statusBar';

/** Collaborators of {@link UsageController}. */
export interface UsageControllerDeps {
  readonly service: UsageService;
  readonly policy: RefreshPolicy;
  readonly statusBar: UsageStatusBar;
  /** Diagnostics sink; never receives the access token. */
  readonly log: vscode.LogOutputChannel;
}

/**
 * Drives periodic quota refreshes.
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
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(private readonly deps: UsageControllerDeps) {
    this.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(CONFIG_SECTION)) this.applyConfig();
      }),
      vscode.window.onDidChangeWindowState((s) => {
        if (s.focused && this.mayPoll() && this.deps.policy.isStale(this.pollMs())) void this.refresh();
      }),
    );
  }

  /**
   * Restores the numbers and backoff from before a reload, then starts polling. No request
   * goes out while a backoff is running or while the restored numbers are still fresh.
   */
  start(): void {
    const { policy, log, statusBar } = this.deps;
    const restored = policy.restore(this.pollMs());
    if (restored.backoffRemainingMs !== undefined) {
      log.info(`Restored backoff: next request in ${formatDuration(restored.backoffRemainingMs)}`);
    }
    if (restored.state) {
      this.state = restored.state;
      log.info(`Restored quota from ${restored.state.fetchedAt.toISOString()}: ${summarizeState(this.state)}`);
      statusBar.render(this.state, this.config);
    }
    this.schedule();
    if (this.mayPoll() && policy.isStale(this.pollMs())) void this.refresh();
  }

  /**
   * Refreshes now. Concurrent calls share the refresh already in progress.
   *
   * @returns A promise that settles once the status bar has been updated.
   */
  refresh(): Promise<void> {
    this.inFlight ??= this.doRefresh().finally(() => {
      this.inFlight = undefined;
      this.deps.policy.markRefreshed();
    });
    return this.inFlight;
  }

  /**
   * Refreshes on explicit user request. During a backoff no request is sent; the user is told
   * when the next one will go out instead.
   *
   * @param notify - Also report the outcome in a notification, so the palette command
   *   visibly does something even when the status bar item is out of view.
   */
  async refreshManually(notify: boolean): Promise<void> {
    const { policy, statusBar, log } = this.deps;
    if (!this.mayPoll()) {
      const wait = formatDuration(policy.backoffRemainingMs());
      log.info(`Manual refresh skipped: rate-limited, next attempt in ${wait}`);
      if (notify) await this.notify(`${this.notificationText()} · next update in ${wait}`, false);
      return;
    }
    statusBar.setRefreshing(true);
    try {
      await this.refresh();
    } finally {
      statusBar.setRefreshing(false);
    }
    if (notify) await this.notify(this.notificationText(), this.state.kind === 'live');
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    vscode.Disposable.from(...this.subscriptions).dispose();
  }

  private async doRefresh(): Promise<void> {
    let resolved: UsageState;
    try {
      resolved = await this.deps.service.resolve();
    } catch (err) {
      // The service handles expected failures; this guards against bugs leaving a stale item.
      resolved = { kind: 'error', message: err instanceof Error ? err.message : String(err) };
    }
    this.deps.log.info(this.deps.statusBar.summary(resolved) ?? summarizeState(resolved));
    const { shown, backoffSeconds } = this.deps.policy.record(resolved);
    if (backoffSeconds) this.deps.log.info(`Backing off polling for ${backoffSeconds}s after a rate limit`);
    this.state = shown;
    this.deps.statusBar.render(this.state, this.config);
  }

  /** What the status bar shows, as one line for a notification. */
  private notificationText(): string {
    return `Tokenwatch: ${this.deps.statusBar.summary() ?? summarizeState(this.state)}`;
  }

  private async notify(message: string, ok: boolean): Promise<void> {
    const choice = ok
      ? await vscode.window.showInformationMessage(message, 'Show Log')
      : await vscode.window.showWarningMessage(message, 'Show Log');
    if (choice === 'Show Log') this.deps.log.show();
  }

  private applyConfig(): void {
    this.config = readConfig();
    this.schedule();
    this.deps.statusBar.render(this.state, this.config);
  }

  private schedule(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (vscode.window.state.focused && this.mayPoll()) void this.refresh();
    }, this.pollMs());
  }

  private mayPoll(): boolean {
    return this.deps.policy.isPastBackoff();
  }

  private pollMs(): number {
    return this.config.pollIntervalSeconds * 1_000;
  }
}
