import fs from 'node:fs';
import path from 'node:path';

function findWorkspacePath(): string {
  if (process.env.ANVIO_WORKSPACE) return process.env.ANVIO_WORKSPACE;

  const cwd = process.cwd();
  const candidates = [path.join(cwd, 'workspace'), cwd];

  for (const candidate of candidates) {
    const configFile = path.join(candidate, 'anvio.yaml');
    const agentsDir = path.join(candidate, 'agents');
    if (fs.existsSync(configFile) || fs.existsSync(agentsDir)) {
      return candidate;
    }
  }

  return path.join(cwd, 'workspace');
}
