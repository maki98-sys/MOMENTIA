import { spawn } from 'node:child_process';

export type ClamVerdict = 'clean' | 'rejected' | 'pending';

/** Accept only a complete clamd INSTREAM terminal response, never a substring. */
export function parseClamAvResponse(response: string): ClamVerdict {
  const terminator = response.indexOf('\0');
  if (terminator < 0) return 'pending';
  const normalized = response.slice(0, terminator).trim();
  const trailing = response.slice(terminator + 1).replace(/\0/g, '').trim();
  if (trailing) throw new Error('ClamAV returned data after its terminal verdict');
  if (!normalized) return 'pending';
  if (/^stream:\s*OK$/i.test(normalized)) return 'clean';
  if (/^stream:\s*.+\sFOUND$/i.test(normalized)) return 'rejected';
  if (/^stream:\s*.+\sERROR$/i.test(normalized)) {
    throw new Error('ClamAV scan failed');
  }
  return 'pending';
}

/**
 * Run FFmpeg with a hard wall-clock limit, bounded diagnostic memory and
 * termination escalation. The timeout is enforced by the worker, not FFmpeg.
 */
export async function runFfmpeg(
  command: string,
  args: string[],
  timeoutMs = 120_000,
  terminationGraceMs = 5_000,
): Promise<void> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
    throw new Error('FFmpeg timeout must be between 1000 and 300000 ms');
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      if (error) reject(error);
      else resolve();
    };
    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-8_192);
    });
    child.once('error', error => finish(error));
    child.once('close', code => {
      if (timedOut) {
        finish(new Error(`FFmpeg timed out after ${timeoutMs} ms`));
      } else if (code === 0) {
        finish();
      } else {
        finish(new Error(`FFmpeg exited ${code}: ${stderr.slice(-1_000)}`));
      }
    });
    timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKill = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, terminationGraceMs);
    }, timeoutMs);
    timeout.unref?.();
    forceKill?.unref?.();
  });
}
