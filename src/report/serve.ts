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
/**
 * What `ng serve` prints when a build fails: the application builder (esbuild),
 * then the older browser builder (webpack). Either way the server keeps watching
 * and never answers, so waiting for the timeout only wastes CI time.
 */
const BUILD_FAILED = /Application bundle generation failed|Failed to compile/;
/** `ng serve` prints this once it has listed the build errors. */
const WATCHING = /Watch mode enabled/;
/** After a failed build, how long to keep collecting its error lines (ms). */
const BUILD_ERRORS_MS = 2000;

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
 * command exits first, the Angular build fails, or `timeoutMs` passes; the
 * error includes the last lines of its output. Always `stop()` the result when
 * the scan is done. Until then, SIGINT/SIGTERM stop the server before the
 * process ends.
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
  // Set when the build fails; `buildErrorsDone` once its error lines are in.
  let buildFailedAt: number | undefined;
  let buildErrorsDone = false;
  const addLine = (line: string) => {
    if (!line.trim()) return;
    options.onOutput?.(line);
    tail.push(line);
    if (tail.length > OUTPUT_TAIL) tail.shift();
    const plain = stripAnsi(line);
    if (buildFailedAt === undefined && BUILD_FAILED.test(plain)) buildFailedAt = Date.now();
    else if (buildFailedAt !== undefined && WATCHING.test(plain)) buildErrorsDone = true;
  };
  // A chunk can end mid-line, so each stream keeps its unfinished last line
  // until the rest arrives (or the stream ends).
  const lineReader = () => {
    let partial = '';
    return {
      data: (chunk: Buffer) => {
        const lines = (partial + chunk.toString()).split(/\r?\n/);
        partial = lines.pop() ?? '';
        lines.forEach(addLine);
      },
      end: () => {
        addLine(partial);
        partial = '';
      },
    };
  };
  for (const stream of [child.stdout, child.stderr]) {
    const reader = lineReader();
    stream?.on('data', reader.data);
    stream?.on('end', reader.end);
  }

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
    if (
      buildFailedAt !== undefined &&
      (buildErrorsDone || Date.now() - buildFailedAt >= BUILD_ERRORS_MS)
    ) {
      await stop();
      throw withOutput(`The Angular build failed, so the dev server never started: ${command}`);
    }
    if (buildFailedAt === undefined && (await isServing(url))) return { reused: false, stop };
    if (Date.now() >= deadline) {
      await stop();
      throw withOutput(`Dev server didn't answer at ${url} within ${Math.round(timeoutMs / 1000)}s: ${command}`);
    }
    await Promise.race([exited, new Promise((r) => setTimeout(r, POLL_MS))]);
  }
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
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
