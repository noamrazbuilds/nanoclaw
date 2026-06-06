/**
 * Container-skill set fingerprint, for the agent-drift safeguard (C3).
 *
 * A session is invalidated when the skill instruction surface it was created
 * with changes — resuming an old session after a skill edit would mix old and
 * new instructions unpredictably. We hash the shared container-skills dir
 * (path + content of every file) and store the digest on the session at
 * creation; a mismatch on the next wake forces a fresh session.
 *
 * Scope is the whole `container/skills/` dir (matching the v1 fork), not the
 * per-group selection: this is a safety control, so erring toward more
 * invalidation (a rare, cheap cold start) is the safe direction, and it keeps
 * the hash out of the per-message session-resolution hot path's config lookups.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export function computeSkillsHash(): string {
  const skillsDir = path.join(process.cwd(), 'container', 'skills');
  if (!fs.existsSync(skillsDir)) return '';

  const hash = crypto.createHash('sha256');
  const walkDir = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__pycache__') continue;
        walkDir(fullPath);
      } else {
        hash.update(fullPath);
        hash.update(fs.readFileSync(fullPath));
      }
    }
  };
  walkDir(skillsDir);
  return hash.digest('hex').slice(0, 16);
}
