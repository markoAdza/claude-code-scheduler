import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

export interface ClaudeCliDetectionResult {
  executablePath: string;
  binDir: string;
}

/**
 * Runs a login shell so nvm/profile-installed `claude` binaries (invisible
 * to cron's minimal PATH) are found the same way an interactive terminal
 * would find them.
 */
export async function detectClaudeCli(shell: string): Promise<ClaudeCliDetectionResult | undefined> {
  try {
    const { stdout } = await execFileAsync(shell, ['-lc', 'command -v claude']);
    const executablePath = stdout.trim();
    if (!executablePath) {
      return undefined;
    }
    return { executablePath, binDir: path.dirname(executablePath) };
  } catch {
    return undefined;
  }
}

export function getConfiguredClaudeExecutablePath(): string | undefined {
  const value = vscode.workspace
    .getConfiguration('claudeCodeScheduler')
    .get<string>('claudeExecutablePath');
  return value?.trim() ? value.trim() : undefined;
}

export function getAdditionalPathEntries(): string[] {
  return (
    vscode.workspace.getConfiguration('claudeCodeScheduler').get<string[]>('additionalPathEntries') ?? []
  );
}

export async function addAdditionalPathEntry(entry: string): Promise<void> {
  const entries = Array.from(new Set([...getAdditionalPathEntries(), entry]));
  await vscode.workspace
    .getConfiguration('claudeCodeScheduler')
    .update('additionalPathEntries', entries, vscode.ConfigurationTarget.Global);
}
