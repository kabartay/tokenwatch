/**
 * @file VS Code entry point: wires the core services to the status bar.
 */

import * as vscode from 'vscode';
import { ContextReader } from './core/contextUsage';
import { CredentialStore } from './core/credentials';
import { LocalUsageEstimator } from './core/localUsage';
import { UsageApiClient } from './core/usageApi';
import { UsageService } from './core/usageService';
import { ContextMonitor } from './vscode/contextMonitor';
import { UsageController } from './vscode/controller';
import { UsageStatusBar } from './vscode/statusBar';

/** Command ids contributed in `package.json`. */
export const REFRESH_COMMAND = 'tokenwatch.refresh';
export const SHOW_LOG_COMMAND = 'tokenwatch.showLog';

/** Arguments the status bar passes to {@link REFRESH_COMMAND}; the palette passes none. */
interface RefreshArgs {
  /** Skip the result notification (the status bar already shows the outcome). */
  readonly quiet?: boolean;
}

/** Called by VS Code once startup has finished (`onStartupFinished`). */
export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Tokenwatch', { log: true });
  const statusBar = new UsageStatusBar({
    command: REFRESH_COMMAND,
    title: 'Refresh',
    arguments: [{ quiet: true } satisfies RefreshArgs],
  });
  const service = new UsageService({
    credentials: CredentialStore.forPlatform(),
    api: new UsageApiClient(),
    estimator: new LocalUsageEstimator(),
    log,
  });
  const controller = new UsageController({ service, statusBar, log });
  const contextMonitor = new ContextMonitor(new ContextReader(), log);

  context.subscriptions.push(
    log,
    statusBar,
    controller,
    contextMonitor,
    vscode.commands.registerCommand(REFRESH_COMMAND, (args?: RefreshArgs) =>
      controller.refreshManually(!args?.quiet),
    ),
    vscode.commands.registerCommand(SHOW_LOG_COMMAND, () => log.show()),
  );
  const { version } = context.extension.packageJSON as { version: string };
  log.info(`Tokenwatch ${version} activated`);
  controller.start();
  contextMonitor.start();
}

/** Nothing to do: everything is disposed through `context.subscriptions`. */
export function deactivate(): void {}
