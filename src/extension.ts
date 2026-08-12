import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ClaudeJobInput } from './jobs/job';
import { JobStore } from './jobs/jobStore';
import { runJobNow } from './jobs/jobRunner';
import { readRunHistory } from './jobs/runHistory';
import { DEFAULT_JOB_TIMEOUT_MINUTES, getScriptPaths, removeJobScript, writeJobScript } from './jobs/scriptGenerator';
import { createSchedulerBackend, SchedulerContext } from './scheduler';
import { addAdditionalPathEntry, detectClaudeCli, getAdditionalPathEntries, getConfiguredClaudeExecutablePath } from './util/claudeCli';
import { isCommandAvailable } from './util/commandAvailability';
import { getInstallCommand } from './util/installClaudeCli';
import { buildVerifySetupCommands } from './util/verifySetup';
import { JobFormPanel } from './ui/jobFormPanel';
import { JobTreeItem, JobsTreeDataProvider } from './ui/jobsTreeDataProvider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel('Claude Code Scheduler');
  context.subscriptions.push(outputChannel);

  const config = vscode.workspace.getConfiguration('claudeCodeScheduler');
  const dataDir = resolveDataDir(config.get<string>('dataDirectory'));
  const shell = config.get<string>('shell') || (process.platform === 'win32' ? '' : process.env.SHELL || '/bin/bash');
  const schedulerContext: SchedulerContext = { dataDir, shell };
  const jobTimeoutMinutes = config.get<number>('jobTimeoutMinutes') ?? DEFAULT_JOB_TIMEOUT_MINUTES;

  const logError = (message: string, error: unknown): void => {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    outputChannel.appendLine(`${message}: ${detail}`);
  };

  const schedulerBackend = createSchedulerBackend();

  if (!(await isCommandAvailable(schedulerBackend.requiredCommand))) {
    void vscode.window.showErrorMessage(
      `Claude Code Scheduler requires the "${schedulerBackend.requiredCommand}" command, which was not found on this system.`,
    );
  }

  const jobStore = new JobStore(dataDir);
  await jobStore.initialize();
  context.subscriptions.push(jobStore);

  const treeDataProvider = new JobsTreeDataProvider(jobStore, dataDir);
  context.subscriptions.push(
    treeDataProvider,
    vscode.window.createTreeView('claudeCodeSchedulerJobs', { treeDataProvider }),
  );

  const resolveClaudeExecutable = async (): Promise<string | undefined> => {
    const configured = getConfiguredClaudeExecutablePath();
    if (configured) {
      return configured;
    }
    const detected = await detectClaudeCli(shell);
    if (!detected) {
      return undefined;
    }
    await addAdditionalPathEntry(detected.binDir);
    return detected.executablePath;
  };

  // Drives the empty-state welcome view in the Jobs tree (see viewsWelcome in package.json), so a
  // brand-new user sees an actionable "install" prompt there instead of only a passing notification.
  const refreshClaudeCliMissingContext = async (): Promise<string | undefined> => {
    const claudeExecutablePath = await resolveClaudeExecutable();
    await vscode.commands.executeCommand(
      'setContext',
      'claudeCodeScheduler.claudeCliMissing',
      !claudeExecutablePath,
    );
    return claudeExecutablePath;
  };

  const INSTALL_TERMINAL_NAME = 'Install Claude Code CLI';
  const VERIFY_SETUP_TERMINAL_NAME = 'Claude Code Scheduler: Verify Setup';
  let installTerminal: vscode.Terminal | undefined;
  let verifyTerminal: vscode.Terminal | undefined;

  const installClaudeCli = (): void => {
    installTerminal?.dispose();
    installTerminal = vscode.window.createTerminal(INSTALL_TERMINAL_NAME);
    installTerminal.show();
    installTerminal.sendText(getInstallCommand());
  };

  const offerInstallOnMissingCli = async (message: string): Promise<void> => {
    const choice = await vscode.window.showErrorMessage(message, 'Install Claude CLI', 'Set Path Manually');
    if (choice === 'Install Claude CLI') {
      installClaudeCli();
    } else if (choice === 'Set Path Manually') {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'claudeCodeScheduler.claudeExecutablePath',
      );
    }
  };

  const syncScheduleFromStore = async (): Promise<void> => {
    try {
      await schedulerBackend.sync(jobStore.getJobs(), schedulerContext);
    } catch (error) {
      logError(`Failed to sync ${schedulerBackend.displayName}`, error);
      void vscode.window.showErrorMessage(
        `Failed to update ${schedulerBackend.displayName}. See the "Claude Code Scheduler" output channel for details.`,
      );
    }
  };

  const saveJob = async (existingId: string | undefined, input: ClaudeJobInput): Promise<void> => {
    const claudeExecutablePath = await resolveClaudeExecutable();
    if (!claudeExecutablePath) {
      throw new Error(
        'Could not locate the "claude" CLI. Set claudeCodeScheduler.claudeExecutablePath in Settings.',
      );
    }
    const job = existingId ? await jobStore.updateJob(existingId, input) : await jobStore.createJob(input);
    await writeJobScript(job, dataDir, claudeExecutablePath, getAdditionalPathEntries(), jobTimeoutMinutes);
    await syncScheduleFromStore();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCodeScheduler.addJob', () => {
      JobFormPanel.show(undefined, (input) => saveJob(undefined, input), schedulerBackend.displayName, resolveClaudeExecutable);
    }),

    vscode.commands.registerCommand('claudeCodeScheduler.editJob', (item: JobTreeItem) => {
      JobFormPanel.show(item.job, (input) => saveJob(item.job.id, input), schedulerBackend.displayName, resolveClaudeExecutable);
    }),

    vscode.commands.registerCommand('claudeCodeScheduler.duplicateJob', (item: JobTreeItem) => {
      const template: ClaudeJobInput = {
        name: `${item.job.name} (copy)`,
        prompt: item.job.prompt,
        cwd: item.job.cwd,
        schedule: item.job.schedule,
        outputPath: item.job.outputPath,
        // Disabled by default: a duplicate of a frequent schedule shouldn't silently start firing
        // twice as often until the user has reviewed and deliberately re-enabled it.
        enabled: false,
      };
      JobFormPanel.show(undefined, (input) => saveJob(undefined, input), schedulerBackend.displayName, resolveClaudeExecutable, template);
    }),

    vscode.commands.registerCommand('claudeCodeScheduler.deleteJob', async (item: JobTreeItem) => {
      const confirmed = await vscode.window.showWarningMessage(
        `Delete job "${item.job.name}"? This removes its scheduled entry and generated files.`,
        { modal: true },
        'Delete',
      );
      if (confirmed !== 'Delete') {
        return;
      }
      await jobStore.deleteJob(item.job.id);
      await removeJobScript(dataDir, item.job.id);
      await syncScheduleFromStore();
    }),

    vscode.commands.registerCommand('claudeCodeScheduler.toggleJob', async (item: JobTreeItem) => {
      await jobStore.setEnabled(item.job.id, !item.job.enabled);
      await syncScheduleFromStore();
    }),

    vscode.commands.registerCommand('claudeCodeScheduler.runJobNow', async (item: JobTreeItem) => {
      try {
        const exitCode = await runJobNow(item.job, dataDir, shell);
        void vscode.window.showInformationMessage(
          exitCode === 0
            ? `"${item.job.name}" finished successfully.`
            : `"${item.job.name}" exited with code ${exitCode}. Check its error log.`,
        );
      } catch (error) {
        logError(`Failed to run job ${item.job.id}`, error);
        void vscode.window.showErrorMessage(`Failed to run "${item.job.name}". See output for details.`);
      }
    }),

    vscode.commands.registerCommand('claudeCodeScheduler.viewOutput', async (item: JobTreeItem) => {
      try {
        const doc = await vscode.workspace.openTextDocument(item.job.outputPath);
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch {
        void vscode.window.showWarningMessage(`No output yet for "${item.job.name}".`);
      }
    }),

    vscode.commands.registerCommand('claudeCodeScheduler.viewErrorLog', async (item: JobTreeItem) => {
      const { errorLog } = getScriptPaths(dataDir, item.job.id);
      try {
        const doc = await vscode.workspace.openTextDocument(errorLog);
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch {
        void vscode.window.showInformationMessage(`No error log yet for "${item.job.name}".`);
      }
    }),

    vscode.commands.registerCommand('claudeCodeScheduler.viewRunHistory', async (item: JobTreeItem) => {
      const { historyFile } = getScriptPaths(dataDir, item.job.id);
      const entries = readRunHistory(historyFile).slice().reverse();
      if (entries.length === 0) {
        void vscode.window.showInformationMessage(`"${item.job.name}" hasn't run yet.`);
        return;
      }
      const picked = await vscode.window.showQuickPick(
        entries.map((entry) => ({
          label: `${entry.exitCode === 0 ? '$(check)' : '$(error)'} ${new Date(entry.timestamp).toLocaleString()}`,
          description: `exit code ${entry.exitCode}`,
        })),
        { title: `Run history: ${item.job.name}`, placeHolder: 'Select a run to open its error log' },
      );
      if (picked) {
        await vscode.commands.executeCommand('claudeCodeScheduler.viewErrorLog', item);
      }
    }),

    vscode.commands.registerCommand('claudeCodeScheduler.openPromptFile', async (item: JobTreeItem) => {
      const { promptFile } = getScriptPaths(dataDir, item.job.id);
      const doc = await vscode.workspace.openTextDocument(promptFile);
      await vscode.window.showTextDocument(doc);
    }),

    vscode.commands.registerCommand('claudeCodeScheduler.redetectClaudeCli', async () => {
      const detected = await detectClaudeCli(shell);
      if (!detected) {
        void vscode.window.showErrorMessage('Could not find the "claude" CLI on this system.');
        return;
      }
      await addAdditionalPathEntry(detected.binDir);
      await refreshClaudeCliMissingContext();
      await JobFormPanel.refreshCurrentCliStatus();
      void vscode.window.showInformationMessage(`Found claude at ${detected.executablePath}.`);
    }),

    vscode.commands.registerCommand('claudeCodeScheduler.resyncCrontab', async () => {
      await syncScheduleFromStore();
      void vscode.window.showInformationMessage(`${schedulerBackend.displayName} synced with Claude Code Scheduler jobs.`);
    }),

    vscode.commands.registerCommand('claudeCodeScheduler.installClaudeCli', () => {
      installClaudeCli();
    }),

    vscode.commands.registerCommand('claudeCodeScheduler.verifySetup', async (cwd?: string) => {
      const targetCwd = cwd?.trim();
      if (!targetCwd) {
        void vscode.window.showWarningMessage('Enter a working directory before verifying setup.');
        return;
      }
      const claudeExecutablePath = await resolveClaudeExecutable();
      if (!claudeExecutablePath) {
        await offerInstallOnMissingCli('Could not locate the "claude" CLI.');
        return;
      }
      verifyTerminal?.dispose();
      verifyTerminal = vscode.window.createTerminal(VERIFY_SETUP_TERMINAL_NAME);
      verifyTerminal.show();
      for (const line of buildVerifySetupCommands(targetCwd, claudeExecutablePath)) {
        verifyTerminal.sendText(line);
      }
    }),

    vscode.window.onDidCloseTerminal(async (closed) => {
      if (closed === verifyTerminal) {
        verifyTerminal = undefined;
        return;
      }
      if (closed !== installTerminal) {
        return;
      }
      installTerminal = undefined;
      const claudeExecutablePath = await refreshClaudeCliMissingContext();
      await JobFormPanel.refreshCurrentCliStatus();
      void vscode.window.showInformationMessage(
        claudeExecutablePath
          ? `Found claude at ${claudeExecutablePath}.`
          : 'Claude CLI still not found. If the installer just finished, you may need to restart VS Code (or open a new terminal) for PATH changes to take effect.',
      );
    }),
  );

  const claudeExecutableAtStartup = await refreshClaudeCliMissingContext();
  if (!claudeExecutableAtStartup) {
    void offerInstallOnMissingCli(
      'Claude Code Scheduler could not find the "claude" CLI. Jobs cannot be scheduled until it is installed.',
    );
  }

  const drifted = await schedulerBackend.hasDrifted(jobStore.getJobs(), schedulerContext).catch((error) => {
    logError('Failed to check schedule drift', error);
    return false;
  });
  if (drifted) {
    void vscode.window
      .showWarningMessage(
        `The system ${schedulerBackend.displayName} has diverged from Claude Code Scheduler's jobs.`,
        'Resync Now',
      )
      .then((choice) => {
        if (choice === 'Resync Now') {
          void vscode.commands.executeCommand('claudeCodeScheduler.resyncCrontab');
        }
      });
  }
}

export function deactivate(): void {
  // No cleanup needed: scripts and crontab entries are meant to outlive the extension host.
}

function resolveDataDir(configured: string | undefined): string {
  const value = configured?.trim() ? configured.trim() : '~/.claude-code-scheduler';
  return value.startsWith('~') ? path.join(os.homedir(), value.slice(1)) : value;
}
