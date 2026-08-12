import { spawn } from 'child_process';
import { ClaudeJob } from './job';
import { getScriptPaths } from './scriptGenerator';

export async function runJobNow(
  job: ClaudeJob,
  dataDir: string,
  shell: string,
  platform: NodeJS.Platform = process.platform,
): Promise<number> {
  const { runScript } = getScriptPaths(dataDir, job.id, platform);
  return new Promise<number>((resolve, reject) => {
    const child =
      platform === 'win32'
        ? spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', runScript])
        : spawn(shell, [runScript]);
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? -1));
  });
}
