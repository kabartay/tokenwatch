/**
 * @file VS Code entry point and composition root: builds each layer's objects and connects them.
 */

import * as vscode from 'vscode';
import { RefreshPolicy } from './application/refreshPolicy';
import { UsageService } from './application/usageService';
import { ContextReader } from './infrastructure/contextReader';
import { CredentialStore } from './infrastructure/credentials';
import { LocalUsageEstimator } from './infrastructure/localUsageEstimator';
import { UsageApiClient } from './infrastructure/usageApiClient';
import { ContextMonitor } from './ui/contextMonitor';
import { UsageController } from './ui/controller';
import { UsageStatusBar } from './ui/statusBar';

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
  const policy = new RefreshPolicy(context.globalState);
  const controller = new UsageController({ service, policy, statusBar, log });
  const contextMonitor = new ContextMonitor(new ContextReader(), statusBar, log);

  context.subscriptions.push(
    log,
    statusBar,
    controller,
    contextMonitor,
    vscode.commands.registerCommand(REFRESH_COMMAND, (args?: RefreshArgs) =>
      Promise.all([controller.refreshManually(!args?.quiet), contextMonitor.refresh()]),
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
