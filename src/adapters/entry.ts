import { agentModeHelp, runAgentMode } from './index.js';

const [flag, ...argv] = process.argv.slice(2);
if (flag === '--agent-server' || flag === '--agent-cli') {
  process.exitCode = await runAgentMode(
    flag === '--agent-server' ? 'server' : 'cli',
    argv,
    process.env,
  );
} else {
  process.stderr.write(agentModeHelp);
  process.exitCode = flag === '--help' ? 0 : 64;
}
