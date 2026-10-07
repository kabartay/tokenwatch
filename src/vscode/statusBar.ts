/**
 * @file Renders a {@link UsageState} into a VS Code status bar item.
 *
 * The status bar can only show text, codicons, a foreground colour and two background
 * colours (warning, error), so bars are drawn with Unicode and urgency maps onto those colours.
 */

import * as vscode from 'vscode';
import { formatCountdown, formatPercent, formatTokens } from '../core/format';
import {
  assess,
  describePace,
  paceOf,
  progressBar,
  WINDOW_LENGTH_MS,
  type AlertLevel,
  type WindowName,
} from '../core/insights';
import type { TokenwatchConfig, UsageSnapshot, UsageState, UsageWindow } from '../core/types';
import { DEFAULT_CONFIG } from './config';

/** Segments in the status bar bar; the tooltip uses a wider one. */
const STATUS_BAR_SEGMENTS = 5;
const TOOLTIP_SEGMENTS = 10;

/** Leading icon per alert level. */
const LEVEL_ICON: Record<AlertLevel, string> = {
  ok: '$(pulse)',
  watch: '$(pulse)',
  warn: '$(warning)',
  critical: '$(error)',
};

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
    this.render({ kind: 'loading' }, DEFAULT_CONFIG);
    this.item.show();
  }

  /**
   * Updates text, tooltip and colour to reflect `state`.
   *
   * @param state - Outcome of the latest refresh.
   * @param config - Current settings (threshold and display style).
   */
  render(state: UsageState, config: TokenwatchConfig): void {
    this.item.backgroundColor = undefined;
    this.item.color = undefined;
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
    const now = new Date();
    const { level, reason } = assess(snapshot, config.warnThresholdPercent, now);
    const { session, weekly } = snapshot;

    const part = (label: string, window: UsageWindow | undefined) =>
      config.statusBarStyle === 'bars' && window
        ? `${label} ${progressBar(window.percentUsed, STATUS_BAR_SEGMENTS)} ${formatPercent(window.percentUsed)}`
        : `${label} ${formatPercent(window?.percentUsed)}`;
    const countdown =
      config.showResetCountdown && session?.resetsAt ? ` ${formatCountdown(session.resetsAt, now)}` : '';
    this.item.text = `${LEVEL_ICON[level]} ${part('5h', session)}${countdown} · ${part('wk', weekly)}`;

    this.applyLevel(level);
    this.item.tooltip = markdown(
      [
        level === 'ok' ? '**Claude usage**' : `**Claude usage** · ${LEVEL_ICON[level]} ${reason ?? ''}`,
        '',
        '| | Used | | Pace | Resets |',
        '| :-- | :-- | --: | :-- | :-- |',
        tooltipRow('session', '5h session', session, now),
        tooltipRow('weekly', 'Weekly', weekly, now),
        '',
        `Updated ${fetchedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · click to refresh`,
      ].join('\n'),
    );
  }

  private applyLevel(level: AlertLevel): void {
    switch (level) {
      case 'critical':
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        return;
      case 'warn':
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        return;
      case 'watch':
        // Background colours are limited to warning/error, so the early heads-up is a tint.
        this.item.color = new vscode.ThemeColor('charts.yellow');
        return;
      case 'ok':
        return;
    }
  }
}

function tooltipRow(name: WindowName, label: string, window: UsageWindow | undefined, now: Date): string {
  if (!window) return `| **${label}** | | – | | |`;
  const pace = paceOf(window, WINDOW_LENGTH_MS[name], now);
  const paceText = pace ? (pace.limitAt ? `$(warning) ${describePace(pace, now)}` : describePace(pace, now)) : '';
  const resets = window.resetsAt
    ? `${formatCountdown(window.resetsAt, now)} · ${formatResetTime(name, window.resetsAt)}`
    : '–';
  return `| **${label}** | \`${progressBar(window.percentUsed, TOOLTIP_SEGMENTS)}\` | ${formatPercent(window.percentUsed)} | ${paceText} | ${resets} |`;
}

/** Session resets are within hours, so the time is enough; weekly resets need the day too. */
function formatResetTime(name: WindowName, at: Date): string {
  return name === 'session'
    ? at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : at.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
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
