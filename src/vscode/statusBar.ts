/**
 * @file Renders quota and context into a single status bar item, one line.
 *
 * The status bar can only show text, codicons, a foreground colour and two background
 * colours (warning, error), so bars are drawn with Unicode and urgency maps onto those colours.
 * Quota and context are polled independently (different sources, different intervals), so
 * each is set separately and the item is repainted from whichever was set last of each kind.
 */

import * as vscode from 'vscode';
import { formatClock, formatCountdown, formatPercent, formatTokens, formatTokensRounded } from '../core/format';
import {
  assess,
  describePace,
  paceOf,
  progressBar,
  WINDOW_LENGTH_MS,
  type AlertLevel,
  type WindowName,
} from '../core/insights';
import type { ContextReading } from '../core/contextUsage';
import type { TokenwatchConfig, UsageSnapshot, UsageState, UsageWindow } from '../core/types';
import { DEFAULT_CONFIG } from './config';

/** Segments in the status bar bar; the tooltip uses a wider one. */
const STATUS_BAR_SEGMENTS = 5;
const TOOLTIP_SEGMENTS = 10;
/** Context colour thresholds; Claude Code starts compacting as the window fills. */
const CONTEXT_WATCH_PERCENT = 70;
const CONTEXT_WARN_PERCENT = 90;

/** Leading icon per quota alert level. */
const LEVEL_ICON: Record<AlertLevel, string> = {
  ok: '$(pulse)',
  watch: '$(pulse)',
  warn: '$(warning)',
  critical: '$(error)',
};

/** One status bar item combining quota and context into a single line. */
export class UsageStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private state: UsageState = { kind: 'loading' };
  private config: TokenwatchConfig = DEFAULT_CONFIG;
  private context: ContextReading | undefined;
  /** True while a manual refresh is in flight: the line stays, only its icon spins. */
  private refreshing = false;

  /** @param clickCommand - Command run when the item is clicked. */
  constructor(clickCommand: vscode.Command) {
    this.item = vscode.window.createStatusBarItem(
      'tokenwatch.usage',
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.name = 'Tokenwatch';
    this.item.command = clickCommand;
    this.repaint();
    this.item.show();
  }

  /**
   * Updates the quota half of the line.
   *
   * @param state - Outcome of the latest quota refresh.
   * @param config - Current settings (threshold and display style).
   */
  render(state: UsageState, config: TokenwatchConfig): void {
    this.state = state;
    this.config = config;
    this.repaint();
  }

  /**
   * Updates the context half of the line.
   *
   * @param context - Latest reading, or `undefined` to drop the segment (no session, or
   *   `tokenwatch.showContext` is off).
   */
  setContext(context: ContextReading | undefined): void {
    this.context = context;
    this.repaint();
  }

  /**
   * Marks a manual refresh as in flight. The current numbers stay on screen and only the
   * leading icon becomes a spinner, so a click never blanks the line.
   */
  setRefreshing(refreshing: boolean): void {
    this.refreshing = refreshing;
    this.repaint();
  }

  /** @returns The context part of the line, e.g. `"ctx: 49%"`, or `undefined` when not shown. */
  contextLabel(): string | undefined {
    return this.context ? `ctx: ${formatPercent(this.context.percent)}` : undefined;
  }

  dispose(): void {
    this.item.dispose();
  }

  private repaint(): void {
    const rendered = this.renderQuota();
    const quota =
      this.refreshing && this.state.kind !== 'loading'
        ? { ...rendered, text: rendered.text.replace(/^\$\([^)]*\)/, '$(sync~spin)') }
        : rendered;
    const contextText = this.contextLabel();
    this.item.text = contextText ? `${quota.text} · ${contextText}` : quota.text;
    this.item.tooltip = combinedTooltip(quota.tooltip, this.context);

    // Context's own warning never outranks a quota warning; quota is the more urgent signal.
    const contextLevel = this.contextLevel();
    this.item.backgroundColor = quota.backgroundColor ?? contextLevel.backgroundColor;
    this.item.color = quota.color ?? contextLevel.color;
  }

  private contextLevel(): Partial<Pick<vscode.StatusBarItem, 'color' | 'backgroundColor'>> {
    if (!this.context) return {};
    if (this.context.percent >= CONTEXT_WARN_PERCENT) {
      return { backgroundColor: new vscode.ThemeColor('statusBarItem.warningBackground') };
    }
    if (this.context.percent >= CONTEXT_WATCH_PERCENT) {
      return { color: new vscode.ThemeColor('charts.yellow') };
    }
    return {};
  }

  private renderQuota(): {
    text: string;
    tooltip: string;
    color?: vscode.ThemeColor;
    backgroundColor?: vscode.ThemeColor;
  } {
    const state = this.state;
    switch (state.kind) {
      case 'loading':
        return { text: '$(sync~spin) Claude usage', tooltip: 'Tokenwatch: fetching usage…' };
      case 'noCredentials':
        return {
          text: '$(account) Claude: log in',
          tooltip:
            'No Claude Code login found (macOS Keychain item `Claude Code-credentials` or ' +
            '`~/.claude/.credentials.json`).\n\nRun `claude`, log in, then click to refresh.',
        };
      case 'live':
        return this.renderLive(state.snapshot, state.fetchedAt, state.staleReason);
      case 'fallback':
        return {
          text: `$(graph-line) ~${formatTokens(state.estimate.tokensToday)} tok today`,
          tooltip:
            `**Live quota unavailable** — ${escape(state.reason)}\n\n` +
            `Showing tokens logged locally today across ${state.estimate.messageCount} ` +
            'messages. This is consumption, not remaining quota.\n\nClick to retry.',
        };
      case 'error':
        return {
          text: '$(error) Claude usage',
          backgroundColor: new vscode.ThemeColor('statusBarItem.errorBackground'),
          tooltip: `**Tokenwatch error** — ${escape(state.message)}\n\nClick to retry.`,
        };
    }
  }

  private renderLive(
    snapshot: UsageSnapshot,
    fetchedAt: Date,
    staleReason: string | undefined,
  ): { text: string; tooltip: string; color?: vscode.ThemeColor; backgroundColor?: vscode.ThemeColor } {
    const now = new Date();
    const { level, reason } = assess(snapshot, this.config.warnThresholdPercent, now);
    const { session, weekly } = snapshot;

    const part = (label: string, window: UsageWindow | undefined) =>
      this.config.statusBarStyle === 'bars' && window
        ? `${label} ${progressBar(window.percentUsed, STATUS_BAR_SEGMENTS)} ${formatPercent(window.percentUsed)}`
        : `${label} ${formatPercent(window?.percentUsed)}`;
    const countdown =
      this.config.showResetCountdown && session?.resetsAt ? ` ${formatCountdown(session.resetsAt, now)}` : '';
    const text = `${LEVEL_ICON[level]} ${part('5h', session)}${countdown} · ${part('wk', weekly)}`;

    const tooltip = [
      level === 'ok' ? '**Claude usage**' : `**Claude usage** · ${LEVEL_ICON[level]} ${reason ?? ''}`,
      '',
      ...(staleReason
        ? [`$(clock) Showing numbers from ${formatClock(fetchedAt)} (${escape(staleReason)}); retrying automatically.`, '']
        : []),
      '| | Used | | Pace | Resets |',
      '| :-- | :-- | --: | :-- | :-- |',
      tooltipRow('session', '5h session', session, now),
      tooltipRow('weekly', 'Weekly', weekly, now),
      '',
      `Updated ${formatClock(fetchedAt)} · click to refresh`,
    ].join('\n');

    let color: vscode.ThemeColor | undefined;
    let backgroundColor: vscode.ThemeColor | undefined;
    if (level === 'critical') backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    else if (level === 'warn') backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    else if (level === 'watch') color = new vscode.ThemeColor('charts.yellow');

    return { text, tooltip, color, backgroundColor };
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

function combinedTooltip(quotaMarkdown: string, context: ContextReading | undefined): vscode.MarkdownString {
  const parts = [quotaMarkdown];
  if (context) {
    const pct = formatPercent(context.percent);
    parts.push(
      [
        '---',
        '**Claude context** · this workspace',
        '',
        `\`${progressBar(context.percent, TOOLTIP_SEGMENTS)}\` **${pct}** · ` +
          `${formatTokensRounded(context.tokens)} of ${formatTokensRounded(context.windowTokens)} tokens`,
        '',
        `${context.model ?? 'unknown model'} · last reply ` +
          context.at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
      ].join('\n'),
    );
  }
  const md = new vscode.MarkdownString(parts.join('\n\n'));
  md.supportThemeIcons = true;
  return md;
}

/** Escapes Markdown control characters in server- or OS-supplied text. */
function escape(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}
