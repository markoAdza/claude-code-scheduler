import * as vscode from 'vscode';
import { getNextRuns } from '../cron/cronExpression';
import { ClaudeJob } from '../jobs/job';
import { JobStore } from '../jobs/jobStore';

function truncate(text: string, maxLength: number): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength - 1)}…` : singleLine;
}

export class JobTreeItem extends vscode.TreeItem {
  constructor(public readonly job: ClaudeJob) {
    super(job.name, vscode.TreeItemCollapsibleState.None);
    this.id = job.id;
    this.contextValue = job.enabled ? 'claudeJob.enabled' : 'claudeJob.disabled';
    this.description = this.buildDescription(job);
    this.iconPath = new vscode.ThemeIcon(this.pickIcon(job));
    this.tooltip = this.buildTooltip(job);
    this.command = { command: 'claudeCodeScheduler.editJob', title: 'Edit Job', arguments: [this] };
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

  private buildDescription(job: ClaudeJob): string {
    const parts = [this.describeNextRun(job), truncate(job.prompt, 60)];
    if (job.lastRun) {
      parts.push(`last exit ${job.lastRun.exitCode}`);
    }
    return parts.join('  ·  ');
  }

  private buildTooltip(job: ClaudeJob): string {
    const lines = [
      job.name,
      `Prompt: ${job.prompt}`,
      `Schedule: ${job.schedule} (${this.describeNextRun(job)})`,
      `Working directory: ${job.cwd}`,
      `Output: ${job.outputPath}`,
    ];
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
