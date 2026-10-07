import * as vscode from 'vscode';
import { getAccessToken } from './credentials';
import { fetchUsage, UsageSnapshot } from './usageClient';
import { estimateTokensUsedToday } from './localLogFallback';

let statusBarItem: vscode.StatusBarItem;
let timer: ReturnType<typeof setInterval> | undefined;

function formatPercent(p: number | undefined): string {
  return typeof p === 'number' ? `${Math.round(p)}%` : '?';
}

async function refresh(): Promise<void> {
  const config = vscode.workspace.getConfiguration('claudeUsage');
  const warnThreshold = config.get<number>('warnThresholdPercent', 80);

  const token = await getAccessToken();
  if (!token) {
    statusBarItem.text = '$(warning) Claude: no login found';
    statusBarItem.tooltip =
      'Could not find Claude Code credentials (Keychain item "Claude Code-credentials" ' +
      'or ~/.claude/.credentials.json). Run `claude` and log in, then refresh.';
    statusBarItem.backgroundColor = undefined;
    return;
  }

  let snapshot: UsageSnapshot | undefined;
  let error: Error | undefined;
  try {
    snapshot = await fetchUsage(token);
  } catch (e) {
    error = e as Error;
  }

  if (snapshot && (snapshot.sessionPercent !== undefined || snapshot.weeklyPercent !== undefined)) {
    const session = formatPercent(snapshot.sessionPercent);
    const weekly = formatPercent(snapshot.weeklyPercent);
    statusBarItem.text = `$(pulse) 5h ${session} · wk ${weekly}`;

    const maxPercent = Math.max(snapshot.sessionPercent ?? 0, snapshot.weeklyPercent ?? 0);
    statusBarItem.backgroundColor =
      maxPercent >= warnThreshold
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : undefined;

    const tooltipLines = [
      `Session (5h): ${session}${snapshot.sessionResetsAt ? ` — resets ${snapshot.sessionResetsAt}` : ''}`,
      `Weekly: ${weekly}${snapshot.weeklyResetsAt ? ` — resets ${snapshot.weeklyResetsAt}` : ''}`,
      '',
      'Click to refresh.',
    ];
    statusBarItem.tooltip = tooltipLines.join('\n');
    return;
  }

  // Endpoint reachable but shape didn't match what we expect, or it failed outright.
  const tokensToday = await estimateTokensUsedToday();
  if (tokensToday !== undefined) {
    statusBarItem.text = `$(pulse) Claude: ~${tokensToday.toLocaleString()} tok today`;
    statusBarItem.backgroundColor = undefined;
    statusBarItem.tooltip = [
      error
        ? `Usage endpoint failed: ${error.message}`
        : 'Usage endpoint response did not match the expected shape.',
      snapshot ? `Raw response: ${JSON.stringify(snapshot.raw).slice(0, 500)}` : '',
      '',
      'Falling back to local session-log token counts (consumption only, not remaining quota).',
      'Click to refresh.',
    ]
      .filter(Boolean)
      .join('\n');
    return;
  }

  statusBarItem.text = '$(error) Claude usage unavailable';
  statusBarItem.tooltip = error ? error.message : 'No usage data available.';
  statusBarItem.backgroundColor = undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'claudeUsage.refresh';
  statusBarItem.text = '$(pulse) Claude: loading…';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeUsage.refresh', () => {
      void refresh();
    })
  );

  const config = vscode.workspace.getConfiguration('claudeUsage');
  const intervalSeconds = config.get<number>('pollIntervalSeconds', 60);
  timer = setInterval(() => void refresh(), Math.max(intervalSeconds, 15) * 1000);
  context.subscriptions.push({ dispose: () => timer && clearInterval(timer) });

  void refresh();
}

export function deactivate(): void {
  if (timer) clearInterval(timer);
}
