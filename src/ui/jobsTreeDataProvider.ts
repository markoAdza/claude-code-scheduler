import * as fsSync from 'fs';
import * as vscode from 'vscode';
import { getNextRuns } from '../cron/cronExpression';
import { ClaudeJob } from '../jobs/job';
import { JobStore } from '../jobs/jobStore';
import { JobRunStatus, readRunStatus, RUNS_TOUCH_FILENAME } from '../jobs/runStatus';
import { getScriptPaths } from '../jobs/scriptGenerator';

function truncate(text: string, maxLength: number): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength - 1)}…` : singleLine;
}

export class JobTreeItem extends vscode.TreeItem {
  constructor(public readonly job: ClaudeJob, runStatus: JobRunStatus | undefined) {
    super(job.name, vscode.TreeItemCollapsibleState.None);
    this.id = job.id;
    this.contextValue = job.enabled ? 'claudeJob.enabled' : 'claudeJob.disabled';
    this.description = this.buildDescription(job, runStatus);
    this.iconPath = new vscode.ThemeIcon(this.pickIcon(job, runStatus));
    this.tooltip = this.buildTooltip(job, runStatus);
    this.command = { command: 'claudeCodeScheduler.editJob', title: 'Edit Job', arguments: [this] };
  }

  private pickIcon(job: ClaudeJob, runStatus: JobRunStatus | undefined): string {
    if (!job.enabled) {
      return 'circle-slash';
    }
    if (runStatus && runStatus.exitCode !== 0) {
      return 'error';
    }
    return 'check';
  }

  private describeNextRun(job: ClaudeJob): string {
    if (!job.enabled) {
      return 'Disabled';
    }
    try {
      const [next] = getNextRuns(job.schedule, 1);
      return `Next: ${next.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
    } catch {
      return 'Invalid schedule';
    }
  }

  private buildDescription(job: ClaudeJob, runStatus: JobRunStatus | undefined): string {
    const parts = [this.describeNextRun(job), truncate(job.prompt, 60)];
    if (runStatus) {
      parts.push(`last exit ${runStatus.exitCode}`);
    }
    return parts.join('  ·  ');
  }

  private buildTooltip(job: ClaudeJob, runStatus: JobRunStatus | undefined): string {
    const lines = [
      job.name,
      `Prompt: ${job.prompt}`,
      `Schedule: ${job.schedule} (${this.describeNextRun(job)})`,
      `Working directory: ${job.cwd}`,
      `Output: ${job.outputPath}`,
    ];
    if (runStatus) {
      lines.push(
        `Last run: ${new Date(runStatus.timestamp).toLocaleString()} (exit code ${runStatus.exitCode})`,
      );
    }
    return lines.join('\n');
  }
}

export class JobsTreeDataProvider implements vscode.TreeDataProvider<JobTreeItem>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private watcher: fsSync.FSWatcher | undefined;

  constructor(private readonly jobStore: JobStore, private readonly dataDir: string) {
    jobStore.onDidChangeJobs(() => this._onDidChangeTreeData.fire());
    this.watchRunStatus();
  }

  dispose(): void {
    this.watcher?.close();
  }

  /**
   * Jobs fired by the OS scheduler (cron/Task Scheduler) run entirely outside VS Code, so the
   * only way to reflect their real status here is to watch for the sentinel file their generated
   * script touches after every run — mirroring how {@link JobStore} watches the data directory
   * for externally-written `jobs.json` changes. Without this, the tree would only ever show the
   * result of manual "Run Now" invocations.
   */
  private watchRunStatus(): void {
    try {
      this.watcher = fsSync.watch(this.dataDir, (_eventType, filename) => {
        if (filename === RUNS_TOUCH_FILENAME) {
          this._onDidChangeTreeData.fire();
        }
      });
    } catch {
      // Best effort: some filesystems (e.g. network mounts) don't support directory watching.
    }
  }

  getTreeItem(element: JobTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): JobTreeItem[] {
    return this.jobStore
      .getJobs()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((job) => {
        const { statusFile } = getScriptPaths(this.dataDir, job.id);
        return new JobTreeItem(job, readRunStatus(statusFile));
      });
  }
}
