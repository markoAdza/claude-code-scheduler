import { spawn } from 'child_process';
import { ClaudeJob } from './job';
import { JobStore } from './jobStore';
import { getScriptPaths } from './scriptGenerator';

export async function runJobNow(
  job: ClaudeJob,
  dataDir: string,
  shell: string,
  jobStore: JobStore,
  platform: NodeJS.Platform = process.platform,
): Promise<number> {
  const { runScript } = getScriptPaths(dataDir, job.id, platform);
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child =
      platform === 'win32'
        ? spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', runScript])
        : spawn(shell, [runScript]);
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? -1));
  });
  await jobStore.recordRun(job.id, { timestamp: new Date().toISOString(), exitCode });
  return exitCode;
}
