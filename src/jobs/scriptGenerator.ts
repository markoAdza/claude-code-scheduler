import * as fs from 'fs/promises';
import * as path from 'path';
import { ClaudeJob } from './job';

export interface JobScriptPaths {
  dir: string;
  promptFile: string;
  runScript: string;
  errorLog: string;
}

export function getScriptPaths(dataDir: string, jobId: string): JobScriptPaths {
  const dir = path.join(dataDir, 'scripts', jobId);
  return {
    dir,
    promptFile: path.join(dir, 'prompt.txt'),
    runScript: path.join(dir, 'run.sh'),
    errorLog: path.join(dir, 'error.log'),
  };
}

export function buildRunScript(
  job: ClaudeJob,
  paths: JobScriptPaths,
  claudeExecutablePath: string,
  additionalPathEntries: string[],
): string {
  const lines = ['#!/bin/bash'];
  if (additionalPathEntries.length > 0) {
    lines.push(`export PATH="${additionalPathEntries.join(':')}:$PATH"`);
  }
  lines.push(`cd "${job.cwd}" || exit 1`);
  lines.push(
    `"${claudeExecutablePath}" -p "$(cat "${paths.promptFile}")" > "${job.outputPath}" 2>> "${paths.errorLog}"`,
  );
  return `${lines.join('\n')}\n`;
}

export async function writeJobScript(
  job: ClaudeJob,
  dataDir: string,
  claudeExecutablePath: string,
  additionalPathEntries: string[],
): Promise<JobScriptPaths> {
  const paths = getScriptPaths(dataDir, job.id);
  await fs.mkdir(paths.dir, { recursive: true });
  await fs.writeFile(paths.promptFile, job.prompt, 'utf8');
  const script = buildRunScript(job, paths, claudeExecutablePath, additionalPathEntries);
  await fs.writeFile(paths.runScript, script, { mode: 0o755 });
  return paths;
}

export async function removeJobScript(dataDir: string, jobId: string): Promise<void> {
  const { dir } = getScriptPaths(dataDir, jobId);
  await fs.rm(dir, { recursive: true, force: true });
}
