import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { AgentConfig } from '../types/index.js';

export function listJDs(ctxRoot?: string): void {
  const baseDir = ctxRoot || process.env.CTX_ROOT || process.cwd();
  const orgsDir = join(baseDir, 'orgs');
  if (!existsSync(orgsDir)) { console.log('No orgs directory found.'); return; }

  let found = 0;
  for (const org of readdirSync(orgsDir)) {
    const agentsDir = join(orgsDir, org, 'agents');
    if (!existsSync(agentsDir)) continue;
    for (const agentName of readdirSync(agentsDir)) {
      const configPath = join(agentsDir, agentName, 'config.json');
      if (!existsSync(configPath)) continue;
      try {
        const config: AgentConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
        if (!config.jd?.title) continue;
        found++;
        console.log(`${agentName.padEnd(20)} ${config.jd.title}`);
        if (config.jd.responsibilities.length) {
          console.log(`  Handles: ${config.jd.responsibilities.slice(0, 2).join('; ')}`);
        }
        if (config.jd.keywords.length) {
          console.log(`  Keywords: ${config.jd.keywords.slice(0, 5).join(', ')}`);
        }
        console.log('');
      } catch { /* skip */ }
    }
  }
  if (!found) console.log('No agents with JD blocks. Add jd fields to config.json files.');
}
