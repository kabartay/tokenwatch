/**
 * @file VS Code entry point: wires the core services to the status bar.
 */

import * as vscode from 'vscode';
import { CredentialStore } from './core/credentials';
import { LocalUsageEstimator } from './core/localUsage';
import { UsageApiClient } from './core/usageApi';
import { UsageController } from './vscode/controller';
import { UsageStatusBar } from './vscode/statusBar';

/** Command id contributed in `package.json`. */
export const REFRESH_COMMAND = 'tokenwatch.refresh';

/** Called by VS Code once startup has finished (`onStartupFinished`). */
export function activate(context: vscode.ExtensionContext): void {
  const statusBar = new UsageStatusBar(REFRESH_COMMAND);
  const controller = new UsageController({
    credentials: CredentialStore.forPlatform(),
    api: new UsageApiClient(),
    localEstimator: new LocalUsageEstimator(),
    statusBar,
  });

  context.subscriptions.push(
    statusBar,
    controller,
    vscode.commands.registerCommand(REFRESH_COMMAND, () => controller.refresh()),
  );
  controller.start();
}

/** Nothing to do: everything is disposed through `context.subscriptions`. */
export function deactivate(): void {}
