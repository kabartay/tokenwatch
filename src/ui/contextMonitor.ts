/**
 * @file Polls context-window usage for this window's folder and feeds it to {@link UsageStatusBar}.
 *
 * No status bar item of its own: quota and context are rendered as one line by `UsageStatusBar`,
 * polled independently because they come from different sources at different rates.
 */

import * as vscode from 'vscode';
import type { ContextSource } from '../application/ports';
import { CONFIG_SECTION, readConfig } from './config';
import type { UsageStatusBar } from './statusBar';

/** Context changes after every reply and reading it is a local tail read, so poll often. */
const POLL_MS = 15_000;

/** Polls the latest session transcript for this window's folders. */
export class ContextMonitor implements vscode.Disposable {
  private showContext = readConfig().showContext;
  private contextWindowTokens = readConfig().contextWindowTokens;
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight = false;
  /** Last diagnostic logged, so each is written once rather than every 15 s poll. */
  private lastLogged: string | undefined;
  /** Last `ctx: N%` logged; the line is logged again only when this changes. */
  private lastLabel: string | undefined;
  private readonly subscriptions: vscode.Disposable[] = [];

  /**
   * @param reader - Reads context size, e.g. from session transcripts.
   * @param statusBar - Shared status bar item to feed readings into.
   * @param log - Diagnostics sink.
   */
  constructor(
    private readonly reader: ContextSource,
    private readonly statusBar: UsageStatusBar,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(CONFIG_SECTION)) {
          const config = readConfig();
          this.showContext = config.showContext;
          this.contextWindowTokens = config.contextWindowTokens;
          void this.refresh();
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh()),
      vscode.window.onDidChangeWindowState((s) => {
        if (s.focused) void this.refresh();
      }),
    );
  }

  /** Reads once now and then every {@link POLL_MS} while the window is focused. */
  start(): void {
    this.timer = setInterval(() => {
      if (vscode.window.state.focused) void this.refresh();
    }, POLL_MS);
    void this.refresh();
  }

  /** Re-reads the transcript and updates the status bar; overlapping calls are dropped. */
  async refresh(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      if (!this.showContext) {
        this.logOnChange('Context: disabled (tokenwatch.showContext is off)');
        this.statusBar.setContext(undefined);
        return;
      }
      const folders = (vscode.workspace.workspaceFolders ?? [])
        .filter((f) => f.uri.scheme === 'file')
        .map((f) => f.uri.fsPath);
      if (folders.length === 0) {
        this.logOnChange('Context: no open folder in this window');
        this.statusBar.setContext(undefined);
        return;
      }
      const reading = await this.reader.read(folders, this.contextWindowTokens);
      if (!reading) this.logOnChange(`Context: no Claude Code session found for [${folders.join(', ')}]`);
      this.statusBar.setContext(reading);
      // Log the status bar's one line when ctx changes; the countdown alone ticking doesn't count.
      const label = this.statusBar.contextLabel();
      if (label && label !== this.lastLabel) {
        const line = this.statusBar.summary();
        if (line) this.log.info(line);
      }
      this.lastLabel = label;
    } catch (err) {
      this.log.warn(`Context read failed: ${err instanceof Error ? err.message : String(err)}`);
      this.statusBar.setContext(undefined);
    } finally {
      this.inFlight = false;
    }
  }

  private logOnChange(message: string): void {
    if (message === this.lastLogged) return;
    this.lastLogged = message;
    this.log.info(message);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    vscode.Disposable.from(...this.subscriptions).dispose();
  }
}
