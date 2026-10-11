// Preserve the native MCP byte stream; never invoke a shell or add profile overrides.
import { spawn } from 'node:child_process';
const binary = process.env.KITSUVO_BINARY?.trim() || 'kitsuvo';
const child = spawn(binary, ['mcp'], { stdio: ['pipe', 'pipe', 'inherit'], shell: false, windowsHide: true });
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stdin.on('error', () => {});
child.on('error', () => { console.error('Kitsuvo could not start. Install it from https://kitsuvo.com and check the configured executable path.'); process.exitCode = 1; process.stdin.destroy(); });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); process.stdin.destroy(); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
process.stdin.on('end', () => child.stdin.end());
