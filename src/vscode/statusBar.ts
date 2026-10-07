/**
 * @file Renders a {@link UsageState} into a VS Code status bar item.
 */

import * as vscode from 'vscode';
import { formatPercent, formatTimeUntil, formatTokens } from '../core/format';
import type { TokenwatchConfig, UsageSnapshot, UsageState, UsageWindow } from '../core/types';

/** Owns the status bar item; stateless apart from it, so any state can be rendered at any time. */
export class UsageStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  /** @param clickCommand - Command run when the item is clicked. */
  constructor(clickCommand: vscode.Command) {
    this.item = vscode.window.createStatusBarItem(
      'tokenwatch.usage',
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.name = 'Tokenwatch';
    this.item.command = clickCommand;
    this.render({ kind: 'loading' }, { pollIntervalSeconds: 60, warnThresholdPercent: 80 });
    this.item.show();
  }

  /**
   * Updates text, tooltip and colour to reflect `state`.
   *
   * @param state - Outcome of the latest refresh.
   * @param config - Current settings (for the warning threshold).
   */
  render(state: UsageState, config: TokenwatchConfig): void {
    this.item.backgroundColor = undefined;
    switch (state.kind) {
      case 'loading':
        this.item.text = '$(sync~spin) Claude';
        this.item.tooltip = 'Tokenwatch: fetching usage…';
        return;
      case 'noCredentials':
        this.item.text = '$(account) Claude: log in';
        this.item.tooltip = markdown(
          'No Claude Code login found (macOS Keychain item `Claude Code-credentials` or ' +
            '`~/.claude/.credentials.json`).\n\nRun `claude`, log in, then click to refresh.',
        );
        return;
      case 'live':
        this.renderLive(state.snapshot, state.fetchedAt, config);
        return;
      case 'fallback':
        this.item.text = `$(graph-line) ~${formatTokens(state.estimate.tokensToday)} tok today`;
        this.item.tooltip = markdown(
          `**Live quota unavailable** — ${escape(state.reason)}\n\n` +
            `Showing tokens logged locally today across ${state.estimate.messageCount} ` +
            'messages. This is consumption, not remaining quota.\n\nClick to retry.',
        );
        return;
      case 'error':
        this.item.text = '$(error) Claude usage';
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.item.tooltip = markdown(`**Tokenwatch error** — ${escape(state.message)}\n\nClick to retry.`);
        return;
    }
  }

  dispose(): void {
    this.item.dispose();
  }

  private renderLive(snapshot: UsageSnapshot, fetchedAt: Date, config: TokenwatchConfig): void {
    const { session, weekly } = snapshot;
    this.item.text = `$(pulse) 5h ${formatPercent(session?.percentUsed)} · wk ${formatPercent(weekly?.percentUsed)}`;

    const peak = Math.max(session?.percentUsed ?? 0, weekly?.percentUsed ?? 0);
    if (peak >= 100) {
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (peak >= config.warnThresholdPercent) {
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }

    this.item.tooltip = markdown(
      [
        '**Claude usage**',
        '',
        '| Window | Used | Resets |',
        '| --- | --- | --- |',
        windowRow('Session (5h)', session),
        windowRow('Weekly (7d)', weekly),
        '',
        `Updated ${fetchedAt.toLocaleTimeString()} · click to refresh`,
      ].join('\n'),
    );
  }
}

function windowRow(label: string, window: UsageWindow | undefined): string {
  const resets = window?.resetsAt
    ? `${formatTimeUntil(window.resetsAt)} (${window.resetsAt.toLocaleString()})`
    : '–';
  return `| ${label} | ${formatPercent(window?.percentUsed)} | ${resets} |`;
}

function markdown(text: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString(text);
  md.supportThemeIcons = true;
  return md;
}

/** Escapes Markdown control characters in server- or OS-supplied text. */
function escape(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}
