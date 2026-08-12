import * as fs from 'fs/promises';
import * as path from 'path';
import { ClaudeJob } from './job';

export interface JobScriptPaths {
  dir: string;
  promptFile: string;
  runScript: string;
  errorLog: string;
}

export function getScriptPaths(
  dataDir: string,
  jobId: string,
  platform: NodeJS.Platform = process.platform,
): JobScriptPaths {
  const dir = path.join(dataDir, 'scripts', jobId);
  const scriptExt = platform === 'win32' ? 'ps1' : 'sh';
  return {
    dir,
    promptFile: path.join(dir, 'prompt.txt'),
    runScript: path.join(dir, `run.${scriptExt}`),
    errorLog: path.join(dir, 'error.log'),
  };
}

function buildRunScriptPosix(
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

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildRunScriptWindows(
  job: ClaudeJob,
  paths: JobScriptPaths,
  claudeExecutablePath: string,
  additionalPathEntries: string[],
): string {
  const lines = [
    '$ErrorActionPreference = "Stop"',
    // Without these, Windows PowerShell decodes/re-encodes native-process I/O using the
    // legacy console codepage instead of UTF-8, corrupting non-ASCII prompt/output text.
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$OutputEncoding = [System.Text.Encoding]::UTF8',
  ];
  if (additionalPathEntries.length > 0) {
    lines.push(`$env:Path = ${psQuote(`${additionalPathEntries.join(';')};`)} + $env:Path`);
  }
  lines.push(`try { Set-Location -LiteralPath ${psQuote(job.cwd)} } catch { exit 1 }`);
  lines.push(
    `$prompt = [System.IO.File]::ReadAllText(${psQuote(paths.promptFile)}, [System.Text.Encoding]::UTF8)`,
  );
  lines.push(
    `& ${psQuote(claudeExecutablePath)} -p $prompt 1> ${psQuote(job.outputPath)} 2>> ${psQuote(paths.errorLog)}`,
  );
  lines.push('exit $LASTEXITCODE');
  return `${lines.join('\n')}\n`;
}

export function buildRunScript(
  job: ClaudeJob,
  paths: JobScriptPaths,
  claudeExecutablePath: string,
  additionalPathEntries: string[],
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === 'win32'
    ? buildRunScriptWindows(job, paths, claudeExecutablePath, additionalPathEntries)
    : buildRunScriptPosix(job, paths, claudeExecutablePath, additionalPathEntries);
}

export async function writeJobScript(
  job: ClaudeJob,
  dataDir: string,
  claudeExecutablePath: string,
  additionalPathEntries: string[],
  platform: NodeJS.Platform = process.platform,
): Promise<JobScriptPaths> {
  const paths = getScriptPaths(dataDir, job.id, platform);
  await fs.mkdir(paths.dir, { recursive: true });
  await fs.writeFile(paths.promptFile, job.prompt, 'utf8');
  const script = buildRunScript(job, paths, claudeExecutablePath, additionalPathEntries, platform);
  await fs.writeFile(paths.runScript, script, platform === 'win32' ? 'utf8' : { mode: 0o755 });
  return paths;
}

export async function removeJobScript(dataDir: string, jobId: string): Promise<void> {
  const { dir } = getScriptPaths(dataDir, jobId);
  await fs.rm(dir, { recursive: true, force: true });
}
