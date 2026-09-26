// @vitest-environment node
/**
 * `startDevServer` against real child processes: a tiny `node -e` HTTP server
 * stands in for `ng serve`.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { isServing, startDevServer, type DevServer } from '../report/serve';

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const { port } = probe.address() as AddressInfo;
  await new Promise((r) => probe.close(r));
  return port;
}

/** A command that prints, waits `delayMs`, then serves on `port`. */
function serveCommand(port: number, delayMs = 300): string {
  const js =
    `console.log('building...');` +
    `setTimeout(() => require('http').createServer((q, s) => s.end('ok'))` +
    `.listen(${port}, '127.0.0.1', () => console.log('listening')), ${delayMs});`;
  return `"${process.execPath}" -e "${js}"`;
}

let running: DevServer | undefined;
let existing: Server | undefined;
afterEach(async () => {
  await running?.stop();
  running = undefined;
  await new Promise((r) => (existing ? existing.close(r) : r(undefined)));
  existing = undefined;
});

describe('startDevServer', () => {
  it('starts the command, resolves once the URL answers, and stop() ends it', async () => {
    const port = await freePort();
    const url = `http://127.0.0.1:${port}/`;
    const lines: string[] = [];
    running = await startDevServer({ command: serveCommand(port), url, onOutput: (l) => lines.push(l) });

    expect(running.reused).toBe(false);
    expect(await isServing(url)).toBe(true);
    expect(lines).toContain('building...');

    await running.stop();
    expect(await isServing(url)).toBe(false);
    await running.stop(); // idempotent
  });

  it('reuses a server that is already answering and starts nothing', async () => {
    const port = await freePort();
    existing = createServer((_q, s) => s.end('ok'));
    await new Promise<void>((r) => existing!.listen(port, '127.0.0.1', r));

    running = await startDevServer({ command: 'exit 1', url: `http://127.0.0.1:${port}/` });
    expect(running.reused).toBe(true);
  });

  it('refuses a busy URL when reuseExisting is false', async () => {
    const port = await freePort();
    existing = createServer((_q, s) => s.end('ok'));
    await new Promise<void>((r) => existing!.listen(port, '127.0.0.1', r));

    await expect(
      startDevServer({ command: 'exit 0', url: `http://127.0.0.1:${port}/`, reuseExisting: false }),
    ).rejects.toThrow(/already serving/);
  });

  it('fails fast with the output tail when the command exits first', async () => {
    const port = await freePort();
    const command = `"${process.execPath}" -e "console.error('Port in use'); process.exit(3)"`;
    await expect(startDevServer({ command, url: `http://127.0.0.1:${port}/` })).rejects.toThrow(
      /exited \(code 3\)[\s\S]*Port in use/,
    );
  });

  it('times out, stops the command, and says why', async () => {
    const port = await freePort();
    const url = `http://127.0.0.1:${port}/`;
    // Would start serving after 5s — well past the 1s timeout.
    const command = serveCommand(port, 5000);
    await expect(startDevServer({ command, url, timeoutMs: 1000 })).rejects.toThrow(
      /didn't answer .* within 1s[\s\S]*building\.\.\./,
    );
    // It was stopped, so it never gets to listen.
    await new Promise((r) => setTimeout(r, 5500));
    expect(await isServing(url)).toBe(false);
  }, 10_000);
});
