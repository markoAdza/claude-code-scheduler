import * as crypto from 'crypto';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { ClaudeJob, ClaudeJobInput } from './job';

/**
 * Persists jobs as human-readable JSON under the data directory (not
 * `context.globalState`), since generated scripts and crontab entries must
 * remain inspectable and runnable independent of VS Code.
 */
export class JobStore implements vscode.Disposable {
  private readonly jobsFilePath: string;
  private jobs: ClaudeJob[] = [];
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();
  private writingSelf = false;
  private watcher: fsSync.FSWatcher | undefined;

  private readonly _onDidChangeJobs = new vscode.EventEmitter<void>();
  readonly onDidChangeJobs = this._onDidChangeJobs.event;

  constructor(private readonly dataDir: string) {
    this.jobsFilePath = path.join(dataDir, 'jobs.json');
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    await this.load();
    this.watchForExternalChanges();
  }

  dispose(): void {
    this.watcher?.close();
  }

  /**
   * jobs.json can be rewritten by another window's JobStore (or the CLI). fs.watch on
   * the containing directory (rather than the file itself) survives our own
   * write-to-temp-then-rename in {@link persist}, which would otherwise invalidate a
   * watch on the file's inode.
   */
  private watchForExternalChanges(): void {
    try {
      this.watcher = fsSync.watch(this.dataDir, (_eventType, filename) => {
        if (filename !== 'jobs.json' || this.writingSelf) {
          return;
        }
        void this.reloadFromDisk();
      });
    } catch {
      // Best effort: some filesystems (e.g. network mounts) don't support directory watching.
    }
  }

  private reloadFromDisk(): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await this.load();
      this._onDidChangeJobs.fire();
    });
    return this.writeQueue;
  }

  getJobs(): ClaudeJob[] {
    this.assertLoaded();
    return [...this.jobs];
  }

  getJob(id: string): ClaudeJob | undefined {
    this.assertLoaded();
    return this.jobs.find((job) => job.id === id);
  }

  async createJob(input: ClaudeJobInput): Promise<ClaudeJob> {
    const now = new Date().toISOString();
    const job: ClaudeJob = { id: crypto.randomUUID(), ...input, createdAt: now, updatedAt: now };
    await this.mutate((jobs) => [...jobs, job]);
    return job;
  }

  async updateJob(id: string, input: ClaudeJobInput): Promise<ClaudeJob> {
    let updated: ClaudeJob | undefined;
    await this.mutate((jobs) =>
      jobs.map((job) => {
        if (job.id !== id) {
          return job;
        }
        updated = { ...job, ...input, updatedAt: new Date().toISOString() };
        return updated;
      }),
    );
    if (!updated) {
      throw new Error(`Job not found: ${id}`);
    }
    return updated;
  }

  async deleteJob(id: string): Promise<void> {
    await this.mutate((jobs) => jobs.filter((job) => job.id !== id));
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.mutate((jobs) =>
      jobs.map((job) =>
        job.id === id ? { ...job, enabled, updatedAt: new Date().toISOString() } : job,
      ),
    );
  }

  async recordRun(id: string, lastRun: ClaudeJob['lastRun']): Promise<void> {
    await this.mutate((jobs) => jobs.map((job) => (job.id === id ? { ...job, lastRun } : job)));
  }

  private async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.jobsFilePath, 'utf8');
      this.jobs = JSON.parse(raw) as ClaudeJob[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.jobs = [];
      } else {
        throw error;
      }
    }
    this.loaded = true;
  }

  private assertLoaded(): void {
    if (!this.loaded) {
      throw new Error('JobStore has not been initialized. Call initialize() first.');
    }
  }

  private mutate(fn: (jobs: ClaudeJob[]) => ClaudeJob[]): Promise<void> {
    this.assertLoaded();
    this.writeQueue = this.writeQueue.then(async () => {
      this.jobs = fn(this.jobs);
      await this.persist();
      this._onDidChangeJobs.fire();
    });
    return this.writeQueue;
  }

  private async persist(): Promise<void> {
    this.writingSelf = true;
    try {
      const tempPath = `${this.jobsFilePath}.${process.pid}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(this.jobs, null, 2), 'utf8');
      await fs.rename(tempPath, this.jobsFilePath);
    } finally {
      this.writingSelf = false;
    }
  }
}
