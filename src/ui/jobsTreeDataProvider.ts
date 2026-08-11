import * as vscode from 'vscode';
import { getNextRuns } from '../cron/cronExpression';
import { ClaudeJob } from '../jobs/job';
import { JobStore } from '../jobs/jobStore';

export class JobTreeItem extends vscode.TreeItem {
  constructor(public readonly job: ClaudeJob) {
    super(job.name, vscode.TreeItemCollapsibleState.None);
    this.id = job.id;
    this.contextValue = job.enabled ? 'claudeJob.enabled' : 'claudeJob.disabled';
    this.description = job.schedule;
    this.iconPath = new vscode.ThemeIcon(this.pickIcon(job));
    this.tooltip = this.buildTooltip(job);
  }

  private pickIcon(job: ClaudeJob): string {
    if (!job.enabled) {
      return 'circle-slash';
    }
    if (job.lastRun && job.lastRun.exitCode !== 0) {
      return 'error';
    }
    return 'check';
  }

  private buildTooltip(job: ClaudeJob): string {
    const lines = [
      job.name,
      `Schedule: ${job.schedule}`,
      `Working directory: ${job.cwd}`,
      `Output: ${job.outputPath}`,
    ];
    if (!job.enabled) {
      lines.push('Disabled');
    } else {
      try {
        const [next] = getNextRuns(job.schedule, 1);
        lines.push(`Next run: ${next.toLocaleString()}`);
      } catch {
        lines.push('Next run: invalid schedule');
      }
    }
    if (job.lastRun) {
      lines.push(
        `Last run: ${new Date(job.lastRun.timestamp).toLocaleString()} (exit code ${job.lastRun.exitCode})`,
      );
    }
    return lines.join('\n');
  }
}

export class JobsTreeDataProvider implements vscode.TreeDataProvider<JobTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly jobStore: JobStore) {
    jobStore.onDidChangeJobs(() => this._onDidChangeTreeData.fire());
  }

  getTreeItem(element: JobTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): JobTreeItem[] {
    return this.jobStore
      .getJobs()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((job) => new JobTreeItem(job));
  }
}
