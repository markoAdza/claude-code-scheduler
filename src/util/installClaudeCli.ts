// Verbatim from https://code.claude.com/docs/en/setup.md ("Install Claude Code").
const POSIX_INSTALL_COMMAND = 'curl -fsSL https://claude.ai/install.sh | bash';
const WINDOWS_INSTALL_COMMAND = 'irm https://claude.ai/install.ps1 | iex';

/**
 * Kept free of any `vscode` import so it can be unit-tested outside the extension host, same as
 * windowsExecutable.ts.
 */
export function getInstallCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? WINDOWS_INSTALL_COMMAND : POSIX_INSTALL_COMMAND;
}
