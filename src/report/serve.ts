import { spawn, type ChildProcess } from 'node:child_process';

export interface DevServerOptions {
  /** Shell command that starts the dev server, e.g. `npx ng serve admin --port 4300`. */
  command: string;
  /** URL to poll until the server answers, e.g. `http://localhost:4300`. */
  url: string;
  /** Give up if the server hasn't answered after this long (ms). Default 180000. */
  timeoutMs?: number;
  /**
   * If something already answers at `url`, scan that and start nothing.
   * Default true — handy locally when `ng serve` is already running.
   */
  reuseExisting?: boolean;
  /** Working directory for the command. Default `process.cwd()`. */
  cwd?: string;
  /** Called with each line the command prints (stdout and stderr). */
  onOutput?: (line: string) => void;
}

export interface DevServer {
  /** True when an already-running server was reused and nothing was started. */
  reused: boolean;
  /** Stop the server (and everything it spawned). Safe to call more than once. */
  stop(): Promise<void>;
}

/** Lines of dev-server output kept for the error message when it fails to start. */
const OUTPUT_TAIL = 30;
const POLL_MS = 500;

/** True when something at `url` answers with a non-5xx response. */
export async function isServing(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: 'manual' });
    await res.body?.cancel();
    return res.status < 500;
  } catch {
    return false;
  }
}

/**
 * Start a dev server and resolve once `url` answers — for report mode in CI,
 * where nothing is running yet. Rejects (after stopping the process) if the
 * command exits first or `timeoutMs` passes; the error includes the last lines
 * of its output. Always `stop()` the result when the scan is done. Until then,
 * SIGINT/SIGTERM stop the server before the process ends.
 */
export async function startDevServer(options: DevServerOptions): Promise<DevServer> {
  const { command, url, timeoutMs = 180_000, reuseExisting = true } = options;

  if (await isServing(url)) {
    if (reuseExisting) return { reused: true, stop: async () => {} };
    throw new Error(`Something is already serving ${url}; stop it or use a different port.`);
  }

  // A process group of its own (POSIX), so stop() also ends what the shell spawned.
  const child = spawn(command, {
    cwd: options.cwd,
    shell: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const tail: string[] = [];
  const collect = (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (!line.trim()) continue;
      options.onOutput?.(line);
      tail.push(line);
      if (tail.length > OUTPUT_TAIL) tail.shift();
    }
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);

  let exitCode: number | null | undefined;
  const exited = new Promise<void>((done) => {
    child.once('exit', (code, signal) => {
      exitCode = code ?? (signal ? -1 : null);
      done();
    });
    child.once('error', (err) => {
      tail.push(err.message);
      exitCode = -1;
      done();
    });
  });

  // The server is in its own process group, so Ctrl+C (or a cancelled CI job)
  // doesn't reach it. Until stop(), pass those signals on, then re-raise them;
  // if the process exits some other way, kill it synchronously.
  const onSignal = (signal: NodeJS.Signals) => {
    void stop().then(() => process.kill(process.pid, signal));
  };
  const onExit = () => killTree(child, 'SIGKILL');
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  process.once('exit', onExit);

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    process.off('exit', onExit);
    if (exitCode === undefined) {
      killTree(child, 'SIGTERM');
      const forced = setTimeout(() => killTree(child, 'SIGKILL'), 5000);
      await exited;
      clearTimeout(forced);
    }
  };

  const withOutput = (message: string) =>
    new Error(tail.length ? `${message}\nLast output:\n  ${tail.join('\n  ')}` : message);

  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (exitCode !== undefined) {
      await stop();
      throw withOutput(`Dev server command exited (code ${exitCode}) before ${url} answered: ${command}`);
    }
    if (await isServing(url)) return { reused: false, stop };
    if (Date.now() >= deadline) {
      await stop();
      throw withOutput(`Dev server didn't answer at ${url} within ${Math.round(timeoutMs / 1000)}s: ${command}`);
    }
    await Promise.race([exited, new Promise((r) => setTimeout(r, POLL_MS))]);
  }
}

function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {
    // Already gone.
  }
}
