import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { IdSchema } from '../contracts/schema.js';
import { Space } from '../core/index.js';
import type { Failure, Result } from '../contracts/errors.js';
import { runAgentCli } from './cli.js';
import { runAgentServer } from './mcp.js';
import { failure, MAX_AGENT_INPUT_BYTES } from './tools.js';

export type AgentMode = 'server' | 'cli';
export const AGENT_TOKEN_ENV = 'AGENTSPACE_TOKEN';

const LaunchSchema = z.strictObject({
  space: z.string().min(1).max(4_096).refine(isAbsolute),
  instance: IdSchema,
  grant: IdSchema,
  token: z.string().min(1).max(128),
  tool: z.string().max(80).optional(),
});
type Launch = z.infer<typeof LaunchSchema>;

export const agentModeHelp = `AgentSpace restricted agent adapter

Development:
  node dist/agent/adapters/entry.js --agent-server --space ABSOLUTE_DIRECTORY --instance UUID --grant UUID
  node dist/agent/adapters/entry.js --agent-cli --space ABSOLUTE_DIRECTORY --instance UUID --grant UUID --tool TOOL < request.json

Set AGENTSPACE_TOKEN in the trusted launch environment. Never pass a token as an argument.
The server uses MCP stdio. The CLI reads one UTF-8 JSON request from stdin (maximum ${MAX_AGENT_INPUT_BYTES} bytes) and writes one JSON Result.
Tools: space_discover, objects_query, object_read, proposal_create, changes_list, operation_status, schema_describe, text_search, relations_expand, accepted_change_read.
There are no human save/review/undo/grant, filesystem, SQL or shell commands.
Only existing supported spaces open. No space is created or migrated.
CLI exit: 0 success; 1 core/startup failure; 64 arguments/schema; 65 JSON/input limit; 70 unexpected adapter failure.
--help writes this help to stderr without opening a space.
Packaged:
  AgentSpace.app/Contents/MacOS/AgentSpace --agent-server --space ABSOLUTE_DIRECTORY --instance UUID --grant UUID
  AgentSpace.app/Contents/MacOS/AgentSpace --agent-cli --space ABSOLUTE_DIRECTORY --instance UUID --grant UUID --tool TOOL < request.json
The packaged executable includes its own runtime.
`;

function parseLaunch(
  mode: AgentMode,
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): Result<Launch> {
  const fields: Record<string, string> = {};
  const allowed =
    mode === 'cli' ? ['space', 'instance', 'grant', 'tool'] : ['space', 'instance', 'grant'];
  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index];
    const value = argv[index + 1];
    const key = argument?.startsWith('--') ? argument.slice(2) : '';
    if (!allowed.includes(key) || value === undefined || Object.hasOwn(fields, key)) {
      return failure('INVALID_INPUT', false, 'launch');
    }
    fields[key] = value;
  }
  if (mode === 'cli' && !fields.tool) return failure('INVALID_INPUT', false, 'tool');
  const parsed = LaunchSchema.safeParse({ ...fields, token: env[AGENT_TOKEN_ENV] });
  if (!parsed.success) return failure('INVALID_INPUT', false, 'launch');
  return { ok: true, value: parsed.data };
}

function reportFailure(mode: AgentMode, result: Failure): void {
  // No stack, request value, path or token is included in diagnostics.
  const stream = mode === 'cli' ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify(result)}\n`);
}

/**
 * Select mode before windows or the desktop instance lock; argv starts after its flag.
 * Owns the Core connection and stdio lifecycle. The caller owns Electron and process exit.
 */
export async function runAgentMode(
  mode: AgentMode,
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  if (argv.length === 1 && argv[0] === '--help') {
    process.stderr.write(agentModeHelp);
    return 0;
  }
  const launch = parseLaunch(mode, argv, env);
  if (!launch.ok) {
    reportFailure(mode, launch);
    return 64;
  }
  const opened = Space.open(launch.value.space);
  if (!opened.ok) {
    reportFailure(mode, opened);
    return 1;
  }
  try {
    const bound = opened.value.agent({
      grantId: launch.value.grant,
      instanceId: launch.value.instance,
      token: launch.value.token,
    });
    if (!bound.ok) {
      reportFailure(mode, bound);
      return 1;
    }
    return mode === 'server'
      ? await runAgentServer(bound.value)
      : await runAgentCli(bound.value, launch.value.tool!);
  } catch {
    reportFailure(mode, failure('STORAGE_FAILURE', false));
    return 70;
  } finally {
    opened.value.close();
  }
}
