import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function isCommandAvailable(command: string): Promise<boolean> {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  try {
    await execFileAsync(finder, [command]);
    return true;
  } catch {
    return false;
  }
}
