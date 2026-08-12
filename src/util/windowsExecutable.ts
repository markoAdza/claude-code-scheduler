import * as fs from 'fs';

/**
 * `where claude` on an npm global install typically resolves `claude.cmd` (PATHEXT doesn't
 * include `.ps1` by default). Since jobs run inside PowerShell, invoking a `.cmd`/`.bat` shim
 * requires an implicit `cmd.exe` hop that re-parses the command line and expands `%...%`
 * sequences in the prompt text. npm always emits a sibling `.ps1` shim alongside `.cmd`; prefer
 * it when present so the prompt is passed as a genuine PowerShell argument instead.
 *
 * Kept in its own module (no `vscode` import) so it can be unit-tested outside the extension host.
 */
export function pickBestWindowsExecutable(
  candidates: string[],
  exists: (candidatePath: string) => boolean = fs.existsSync,
): string | undefined {
  const first = candidates[0];
  if (!first) {
    return undefined;
  }
  if (/\.(cmd|bat)$/i.test(first)) {
    const ps1Sibling = first.replace(/\.(cmd|bat)$/i, '.ps1');
    if (exists(ps1Sibling)) {
      return ps1Sibling;
    }
  }
  return first;
}
