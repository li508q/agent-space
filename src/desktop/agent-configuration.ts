import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import type { AgentLaunchConfiguration } from '../contracts/app.js';

export async function agentRuntime(
  directory: string,
): Promise<typeof import('../adapters/index.js')> {
  // Compiled adapter output is loaded lazily. It is never a renderer resource.
  return import(pathToFileURL(join(directory, '../agent/adapters/index.js')).href) as Promise<
    typeof import('../adapters/index.js')
  >;
}
export function launchConfiguration(options: {
  executable: string;
  mainEntry: string;
  packaged: boolean;
  space: string;
  instanceId: string;
  grantId: string;
  token: string;
  tokenEnv: string;
}): AgentLaunchConfiguration {
  const args = [
    ...(options.packaged ? [] : [options.mainEntry]),
    '--agent-server',
    '--space',
    options.space,
    '--instance',
    options.instanceId,
    '--grant',
    options.grantId,
  ];
  const env = { [options.tokenEnv]: options.token };
  const codexToml =
    '[mcp_servers.agent_space]\ncommand = ' +
    JSON.stringify(options.executable) +
    '\nargs = [' +
    args.map((a) => JSON.stringify(a)).join(', ') +
    ']\n\n[mcp_servers.agent_space.env]\n' +
    options.tokenEnv +
    ' = ' +
    JSON.stringify(options.token) +
    '\n';
  // Launch parameters, not a claim that every MCP host shares one configuration schema.
  const stdioJson = JSON.stringify({ command: options.executable, args, env }, null, 2);
  return {
    command: options.executable,
    args,
    env,
    codexToml,
    stdioJson,
    development: !options.packaged,
  };
}
