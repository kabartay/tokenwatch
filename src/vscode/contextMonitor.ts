/**
 * @file Status bar item showing how full the context window is for this window's Claude session.
 *
 * Separate from the quota item: quota is per account, context is per session, and users can
 * hide either one from the status bar's context menu.
 */

import * as vscode from 'vscode';
import type { ContextReader, ContextReading } from '../core/contextUsage';
import { formatPercent, formatTokensRounded } from '../core/format';
import { progressBar } from '../core/insights';
import type { TokenwatchConfig } from '../core/types';
import { CONFIG_SECTION, readConfig } from './config';

/** Context changes after every reply and reading it is a local tail read, so poll often. */
const POLL_MS = 15_000;
/** Yellow text from here; Claude Code compacts the conversation as the window fills. */
const WATCH_PERCENT = 70;
/** Amber background from here. */
const WARN_PERCENT = 90;

/** Polls the latest session transcript for this window's folders and renders `ctx N%`. */
export class ContextMonitor implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private config: TokenwatchConfig = readConfig();
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight = false;
  private readonly subscriptions: vscode.Disposable[] = [];

  /**
   * @param reader - Reads context size from session transcripts.
   * @param log - Diagnostics sink.
   */
  constructor(
    private readonly reader: ContextReader,
    private readonly log: vscode.LogOutputChannel,
  ) {
    // Priority 99 places it immediately to the right of the quota item (100).
    this.item = vscode.window.createStatusBarItem(
      'tokenwatch.context',
      vscode.StatusBarAlignment.Right,
      99,
    );
    this.item.name = 'Tokenwatch: Context';
    this.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(CONFIG_SECTION)) {
          this.config = readConfig();
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

  /** Re-reads the transcript and updates the item; overlapping calls are dropped. */
  async refresh(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const folders = (vscode.workspace.workspaceFolders ?? [])
        .filter((f) => f.uri.scheme === 'file')
        .map((f) => f.uri.fsPath);
      const reading =
        this.config.showContext && folders.length > 0
          ? await this.reader.read(folders, this.config.contextWindowTokens)
          : undefined;
      this.render(reading);
    } catch (err) {
      this.log.warn(`Context read failed: ${err instanceof Error ? err.message : String(err)}`);
      this.item.hide();
    } finally {
      this.inFlight = false;
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    vscode.Disposable.from(...this.subscriptions).dispose();
    this.item.dispose();
  }

  /** Hides the item when there's nothing to show, rather than cluttering the bar with `–`. */
  private render(reading: ContextReading | undefined): void {
    if (!reading) {
      this.item.hide();
      return;
    }
    const pct = formatPercent(reading.percent);
    this.item.text =
      this.config.statusBarStyle === 'bars' ? `ctx ${progressBar(reading.percent)} ${pct}` : `ctx ${pct}`;

    this.item.color = undefined;
    this.item.backgroundColor = undefined;
    if (reading.percent >= WARN_PERCENT) {
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else if (reading.percent >= WATCH_PERCENT) {
      this.item.color = new vscode.ThemeColor('charts.yellow');
    }

    const windowNote = reading.windowInferred
      ? `Window size inferred. If it's wrong for this model, set \`tokenwatch.contextWindowTokens\`, ` +
        `for example \`{ "${modelFamily(reading.model)}": ${reading.windowTokens === 200_000 ? '1000000' : '200000'} }\`.`
      : 'Window size from `tokenwatch.contextWindowTokens`.';
    const md = new vscode.MarkdownString(
      [
        '**Claude context** · this workspace',
        '',
        `\`${progressBar(reading.percent, 10)}\` **${pct}** · ${formatTokensRounded(reading.tokens)} of ${formatTokensRounded(reading.windowTokens)} tokens`,
        '',
        `${reading.model ?? 'unknown model'} · last reply ${reading.at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`,
        '',
        windowNote,
      ].join('\n'),
    );
    this.item.tooltip = md;
    this.item.show();
  }
}

/** `claude-opus-5-5` → `claude-opus`, a settings key that covers future versions too. */
function modelFamily(model: string | undefined): string {
  const match = model?.match(/^claude-[a-z]+/);
  return match ? match[0] : (model ?? '*');
}
