// send.mjs — queue a runScript command to the AE MCP bridge and wait for the result
// usage: node send.mjs <script.jsx> [timeoutSec]
import fs from 'fs';
import path from 'path';
import os from 'os';

const bridgeDir = path.join(os.homedir(), 'Documents', 'ae-mcp-bridge');
const commandFile = path.join(bridgeDir, 'ae_command.json');
const resultFile = path.join(bridgeDir, 'ae_mcp_result.json');

const scriptPath = process.argv[2];
const timeoutSec = Number(process.argv[3] || 60);
const script = fs.readFileSync(scriptPath, 'utf8');

// clear stale result
fs.writeFileSync(resultFile, JSON.stringify({ status: 'waiting' }));

fs.writeFileSync(commandFile, JSON.stringify({
  command: 'runScript',
  args: { script },
  timestamp: new Date().toISOString(),
  status: 'pending',
}, null, 2));

const deadline = Date.now() + timeoutSec * 1000;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 1500));
  try {
    const cmd = JSON.parse(fs.readFileSync(commandFile, 'utf8'));
    if (cmd.status === 'completed' || cmd.status === 'error') {
      console.log(fs.readFileSync(resultFile, 'utf8'));
      process.exit(0);
    }
  } catch { /* mid-write, retry */ }
}
console.error('TIMEOUT waiting for AE bridge');
process.exit(1);
