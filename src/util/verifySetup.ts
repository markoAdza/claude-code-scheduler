const VERIFY_PROMPT = 'Reply with just: OK';

/** Double quotes are understood by every shell VS Code might use as the integrated terminal's
 * default (bash, zsh, fish, PowerShell, cmd), which is what this targets — unlike scriptGenerator's
 * shQuote/psQuote, which each escape for one specific, known shell. */
function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Builds the command lines sent to a real, visible terminal so the user can answer Claude Code's
 * first-run "trust this folder?" prompt themselves — something a headless cron/Task Scheduler run
 * (no TTY) can never do. Mirrors the exact invocation scriptGenerator uses (`claude -p "..."`) so
 * this is a faithful test of what the scheduled job will actually run.
 */
export function buildVerifySetupCommands(cwd: string, claudeExecutablePath: string): string[] {
  return [`cd ${quote(cwd)}`, `${quote(claudeExecutablePath)} -p ${quote(VERIFY_PROMPT)}`];
}
