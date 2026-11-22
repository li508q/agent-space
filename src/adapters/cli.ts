import type { AgentServices } from '../contracts/core.js';
import type { Result } from '../contracts/errors.js';
import { failure, invokeAgentTool, MAX_AGENT_INPUT_BYTES } from './tools.js';

/** JSON stdin is bounded before decoding/parsing; errors contain no input text. */
async function readInput(): Promise<Result<unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of process.stdin) {
      const bytes: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += bytes.byteLength;
      if (size > MAX_AGENT_INPUT_BYTES) return failure('LIMIT_EXCEEDED', false, 'stdin');
      chunks.push(bytes);
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return failure('INVALID_INPUT', false, 'stdin');
  }
}

export async function runAgentCli(agent: AgentServices, tool: string): Promise<number> {
  const input = await readInput();
  if (!input.ok) {
    process.stdout.write(`${JSON.stringify(input)}\n`);
    return 65;
  }
  const result = invokeAgentTool(agent, tool, input.value);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.ok ? 0 : result.error.code === 'INVALID_INPUT' ? 64 : 1;
}
