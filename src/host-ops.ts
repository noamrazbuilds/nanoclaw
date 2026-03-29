/**
 * Host Operations — predefined operations that run outside the container
 * with full host filesystem access. Only main-group agents can trigger these
 * via IPC. Each operation is hardcoded and audited — no arbitrary commands.
 */
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

import { logger } from './logger.js';

const ALLOWED_OPS = [
  'refresh_oauth',
  'restart_service',
  'rebuild_container',
] as const;
export type HostOp = (typeof ALLOWED_OPS)[number];

export function isValidHostOp(op: string): op is HostOp {
  return ALLOWED_OPS.includes(op as HostOp);
}

interface HostOpResult {
  ok: boolean;
  message: string;
}

/**
 * Re-extract the OAuth access token from ~/.claude/.credentials.json
 * and update .env with it.
 */
function refreshOauth(): HostOpResult {
  const credPath = path.join(
    process.env.HOME || '/root',
    '.claude',
    '.credentials.json',
  );

  try {
    if (!fs.existsSync(credPath)) {
      return {
        ok: false,
        message: 'Credentials file not found at ' + credPath,
      };
    }

    const data = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
    const oauth =
      typeof data.claudeAiOauth === 'string'
        ? JSON.parse(data.claudeAiOauth)
        : data.claudeAiOauth;

    if (!oauth?.accessToken) {
      return { ok: false, message: 'No accessToken found in credentials' };
    }

    const envPath = path.join(process.cwd(), '.env');
    let content = fs.readFileSync(envPath, 'utf-8');
    if (content.includes('CLAUDE_OAUTH_TOKEN=')) {
      content = content.replace(
        /^CLAUDE_OAUTH_TOKEN=.*$/m,
        `CLAUDE_OAUTH_TOKEN=${oauth.accessToken}`,
      );
    } else {
      content += `\nCLAUDE_OAUTH_TOKEN=${oauth.accessToken}\n`;
    }
    fs.writeFileSync(envPath, content);

    // Check expiry
    const expiresIn = oauth.expiresAt
      ? Math.round((oauth.expiresAt - Date.now()) / 60000)
      : null;
    const expiryNote =
      expiresIn != null ? ` Token expires in ~${expiresIn} minutes.` : '';

    return {
      ok: true,
      message: `OAuth token extracted and written to .env.${expiryNote}`,
    };
  } catch (err: any) {
    return { ok: false, message: `Failed: ${err.message}` };
  }
}

/**
 * Restart the NanoClaw systemd service.
 * Returns a promise since exec is async.
 */
function restartService(): Promise<HostOpResult> {
  return new Promise((resolve) => {
    exec(
      'systemctl --user restart nanoclaw',
      { timeout: 30000 },
      (err, _stdout, stderr) => {
        if (err) {
          resolve({
            ok: false,
            message: `Restart failed: ${stderr || err.message}`,
          });
        } else {
          resolve({ ok: true, message: 'NanoClaw service restarted.' });
        }
      },
    );
  });
}

/**
 * Rebuild the agent container image.
 */
function rebuildContainer(): Promise<HostOpResult> {
  return new Promise((resolve) => {
    const buildScript = path.join(process.cwd(), 'container', 'build.sh');
    if (!fs.existsSync(buildScript)) {
      resolve({ ok: false, message: 'Build script not found: ' + buildScript });
      return;
    }

    exec(
      buildScript,
      { timeout: 300000, cwd: process.cwd() },
      (err, stdout, stderr) => {
        if (err) {
          resolve({
            ok: false,
            message: `Build failed: ${(stderr || err.message).slice(0, 500)}`,
          });
        } else {
          resolve({
            ok: true,
            message: 'Container image rebuilt successfully.',
          });
        }
      },
    );
  });
}

/**
 * Execute a predefined host operation.
 */
export async function executeHostOp(op: HostOp): Promise<HostOpResult> {
  logger.info({ op }, 'Executing host operation');

  let result: HostOpResult;
  switch (op) {
    case 'refresh_oauth':
      result = refreshOauth();
      break;
    case 'restart_service':
      result = await restartService();
      break;
    case 'rebuild_container':
      result = await rebuildContainer();
      break;
  }

  logger.info(
    { op, ok: result.ok, message: result.message },
    'Host operation completed',
  );
  return result;
}
