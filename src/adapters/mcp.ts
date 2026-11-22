import { Server, type CallToolResult, type Tool } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { Transform } from 'node:stream';
import { z } from 'zod';
import type { AgentServices } from '../contracts/core.js';
import { AgentToolSchema } from '../contracts/schema.js';
import { invokeAgentTool, MAX_AGENT_INPUT_BYTES, toolDefinitions } from './tools.js';

/** Schema JSON and runtime validation share the ten implemented tool definitions. */
export function createAgentServer(agent: AgentServices): Server {
  // The SDK's advanced Server API keeps the application's stable Result envelope
  // for schema failures as well as domain failures (instead of English SDK errors).
  const server = new Server(
    { name: 'AgentSpace', version: '0.1.0' },
    {
      capabilities: { tools: {} },
      instructions:
        'Use space_discover first. Access is bound to the configured local space and grant. Read bounded pinned sections; query returns current material. proposal_create only preserves a candidate for human review. Keep operation keys when a result is uncertain. Activity describes prepared results, not host receipt, model understanding or task completion.',
    },
  );
  const tools: Tool[] = AgentToolSchema.options.map((name) => ({
    name,
    description: toolDefinitions[name].description,
    inputSchema: JSON.parse(
      JSON.stringify({
        ...z.toJSONSchema(toolDefinitions[name].schema, { io: 'input' }),
        type: 'object',
      }),
    ) as Tool['inputSchema'],
    annotations: {
      readOnlyHint: name !== 'proposal_create',
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }));
  server.setRequestHandler('tools/list', () => ({ tools }));
  server.setRequestHandler('tools/call', (request): CallToolResult => {
    const result = invokeAgentTool(agent, request.params.name, request.params.arguments ?? {});
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result as unknown as CallToolResult['structuredContent'],
      isError: !result.ok,
    };
  });
  return server;
}

class ObservedStdioTransport extends StdioServerTransport {
  #closed: () => void;
  constructor(input: Transform, closed: () => void) {
    super(input, process.stdout, { maxBufferSize: MAX_AGENT_INPUT_BYTES });
    this.#closed = closed;
  }
  override async close(): Promise<void> {
    try {
      await super.close();
    } finally {
      this.#closed();
    }
  }
}

export async function runAgentServer(agent: AgentServices): Promise<number> {
  let exitCode = 0;
  let finish: () => void = () => {};
  const ended = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const input = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        decoder.decode(chunk, { stream: true });
        callback(null, chunk);
      } catch {
        callback(new Error('Invalid protocol encoding'));
      }
    },
    flush(callback) {
      try {
        decoder.decode();
        callback();
      } catch {
        callback(new Error('Invalid protocol encoding'));
      }
    },
  });
  const transport = new ObservedStdioTransport(input, finish);
  let diagnosticWritten = false;
  const diagnose = () => {
    // SDK exceptions can include request data. Never print the exception itself.
    if (!diagnosticWritten) process.stderr.write('AgentSpace: protocol error.\n');
    diagnosticWritten = true;
  };
  input.on('error', () => {
    exitCode = 65;
    diagnose();
    void transport.close();
  });
  const handle = serveStdio(() => createAgentServer(agent), {
    legacy: 'serve',
    transport,
    onerror: () => {
      exitCode = 65;
      diagnose();
      void transport.close();
    },
  });
  const interrupt = () => {
    exitCode = 130;
    finish();
  };
  const terminate = () => {
    exitCode = 143;
    finish();
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  process.stdin.pipe(input);
  try {
    await ended;
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
    process.stdin.unpipe(input);
    process.stdin.pause();
    await handle.close();
    input.destroy();
  }
  return exitCode;
}
