/**
 * @file Reads and validates the `tokenwatch.*` settings.
 */

import * as vscode from 'vscode';
import type { TokenwatchConfig } from '../core/types';

/** Settings section; every key in `package.json` → `contributes.configuration` sits under it. */
export const CONFIG_SECTION = 'tokenwatch';

/** Floor for the poll interval, so a typo can't hammer an undocumented endpoint. */
export const MIN_POLL_INTERVAL_SECONDS = 60;

/** @returns The current settings, clamped to safe ranges. */
export function readConfig(): TokenwatchConfig {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    pollIntervalSeconds: Math.max(
      MIN_POLL_INTERVAL_SECONDS,
      cfg.get<number>('pollIntervalSeconds', 180),
    ),
    warnThresholdPercent: Math.min(100, Math.max(0, cfg.get<number>('warnThresholdPercent', 80))),
    statusBarStyle: cfg.get<string>('statusBarStyle') === 'compact' ? 'compact' : 'bars',
    showResetCountdown: cfg.get<boolean>('showResetCountdown', true),
    showContext: cfg.get<boolean>('showContext', true),
    contextWindowTokens: cfg.get<Record<string, number>>('contextWindowTokens', {}),
  };
}

/** Settings used before the first read, e.g. for the initial "loading" render. */
export const DEFAULT_CONFIG: TokenwatchConfig = {
  pollIntervalSeconds: 180,
  warnThresholdPercent: 80,
  statusBarStyle: 'bars',
  showResetCountdown: true,
  showContext: true,
  contextWindowTokens: {},
};
