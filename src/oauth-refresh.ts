/**
 * OAuth Token Refresh for Claude Max Subscription
 *
 * Monitors the Claude OAuth token, auto-refreshes before expiry using the
 * refresh token from ~/.claude/.credentials.json, and notifies the user
 * via messaging channel if refresh fails.
 */
import fs from 'fs';
import path from 'path';
import https from 'https';

import { logger } from './logger.js';

const CREDENTIALS_PATH = path.join(
  process.env.HOME || '/root',
  '.claude',
  '.credentials.json',
);

// Refresh 10 minutes before expiry
const REFRESH_BUFFER_MS = 10 * 60 * 1000;
// Check every 5 minutes
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes?: string[];
  subscriptionType?: string;
  rateLimitTier?: string;
}

let notifyFn: ((message: string) => Promise<void>) | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let lastNotifiedExpiry = 0;

/**
 * Read OAuth credentials from the Claude credentials file.
 */
function readCredentials(): OAuthCredentials | null {
  try {
    if (!fs.existsSync(CREDENTIALS_PATH)) return null;
    const data = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
    const oauth =
      typeof data.claudeAiOauth === 'string'
        ? JSON.parse(data.claudeAiOauth)
        : data.claudeAiOauth;
    if (!oauth?.accessToken || !oauth?.refreshToken || !oauth?.expiresAt) {
      return null;
    }
    return oauth as OAuthCredentials;
  } catch (err) {
    logger.warn({ err }, 'Failed to read Claude OAuth credentials');
    return null;
  }
}

/**
 * Write updated OAuth credentials back to the credentials file.
 */
function writeCredentials(creds: OAuthCredentials): void {
  try {
    const data = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
    data.claudeAiOauth = JSON.stringify(creds);
    fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(data));
  } catch (err) {
    logger.error({ err }, 'Failed to write updated OAuth credentials');
  }
}

/**
 * Update the CLAUDE_OAUTH_TOKEN in .env with the new access token.
 */
function updateEnvToken(newToken: string): void {
  const envPath = path.join(process.cwd(), '.env');
  try {
    let content = fs.readFileSync(envPath, 'utf-8');
    if (content.includes('CLAUDE_OAUTH_TOKEN=')) {
      content = content.replace(
        /^CLAUDE_OAUTH_TOKEN=.*$/m,
        `CLAUDE_OAUTH_TOKEN=${newToken}`,
      );
    } else {
      content += `\nCLAUDE_OAUTH_TOKEN=${newToken}\n`;
    }
    fs.writeFileSync(envPath, content);
    logger.info('Updated CLAUDE_OAUTH_TOKEN in .env');
  } catch (err) {
    logger.error({ err }, 'Failed to update .env with new token');
  }
}

/**
 * Refresh the OAuth token using the refresh token.
 * Uses the Claude.ai OAuth endpoint.
 */
async function refreshToken(
  refreshToken: string,
): Promise<OAuthCredentials | null> {
  return new Promise((resolve) => {
    const postData = JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    const req = https.request(
      {
        hostname: 'console.anthropic.com',
        path: '/v1/oauth/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            logger.error(
              { statusCode: res.statusCode, body: body.slice(0, 500) },
              'OAuth token refresh failed',
            );
            resolve(null);
            return;
          }
          try {
            const data = JSON.parse(body);
            resolve({
              accessToken: data.access_token,
              refreshToken: data.refresh_token || refreshToken,
              expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
              scopes: data.scopes,
              subscriptionType: data.subscription_type,
              rateLimitTier: data.rate_limit_tier,
            });
          } catch (err) {
            logger.error({ err, body: body.slice(0, 200) }, 'Failed to parse refresh response');
            resolve(null);
          }
        });
      },
    );

    req.on('error', (err) => {
      logger.error({ err }, 'OAuth refresh request error');
      resolve(null);
    });

    req.setTimeout(15000, () => {
      req.destroy();
      resolve(null);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Check token expiry and refresh if needed.
 */
async function checkAndRefresh(): Promise<void> {
  const creds = readCredentials();
  if (!creds) {
    logger.debug('No OAuth credentials found, skipping refresh check');
    return;
  }

  const now = Date.now();
  const timeUntilExpiry = creds.expiresAt - now;

  if (timeUntilExpiry > REFRESH_BUFFER_MS) {
    const hoursLeft = (timeUntilExpiry / 3600000).toFixed(1);
    logger.debug({ hoursLeft }, 'OAuth token still valid');
    return;
  }

  logger.info(
    { expiresIn: Math.round(timeUntilExpiry / 1000) },
    'OAuth token expiring soon, attempting refresh',
  );

  const newCreds = await refreshToken(creds.refreshToken);

  if (newCreds) {
    // Update credentials file and .env
    writeCredentials(newCreds);
    updateEnvToken(newCreds.accessToken);

    const hoursUntil = ((newCreds.expiresAt - Date.now()) / 3600000).toFixed(1);
    logger.info({ expiresInHours: hoursUntil }, 'OAuth token refreshed successfully');
    lastNotifiedExpiry = 0; // Reset notification flag
  } else {
    // Refresh failed — notify user
    if (lastNotifiedExpiry !== creds.expiresAt && notifyFn) {
      lastNotifiedExpiry = creds.expiresAt;
      const minutesLeft = Math.max(0, Math.round(timeUntilExpiry / 60000));

      const message =
        `⚠️ *Claude Max Token Expiring*\n\n` +
        `The OAuth token expires in ~${minutesLeft} minutes and auto-refresh failed. ` +
        `NanoClaw will fall back to API billing when it expires.\n\n` +
        `*To re-authenticate:*\n` +
        `1. SSH into the server\n` +
        `2. Run: \`claude login\`\n` +
        `3. Then: \`cd ~/NanoClaw && python3 -c "import json; f=open('/home/nanoclaw/.claude/.credentials.json'); d=json.load(f); o=json.loads(d['claudeAiOauth']); print(o['accessToken'])" | xargs -I{} sed -i 's/^CLAUDE_OAUTH_TOKEN=.*/CLAUDE_OAUTH_TOKEN={}/' .env\`\n` +
        `4. Restart: \`systemctl --user restart nanoclaw\``;

      notifyFn(message).catch((err) =>
        logger.error({ err }, 'Failed to send token expiry notification'),
      );
    }
  }
}

/**
 * Detect auth errors in container stderr output.
 * Returns true if the error looks like an expired/invalid OAuth token.
 */
export function isAuthError(stderr: string): boolean {
  const authPatterns = [
    /credential.*not authorized/i,
    /oauth.*token.*expired/i,
    /authentication.*failed/i,
    /invalid.*token/i,
    /401.*unauthorized/i,
    /token.*revoked/i,
  ];
  return authPatterns.some((p) => p.test(stderr));
}

/**
 * Start the OAuth token refresh monitor.
 * Call this during NanoClaw startup.
 */
export function startOAuthRefreshMonitor(
  notify: (message: string) => Promise<void>,
): void {
  notifyFn = notify;

  // Initial check
  checkAndRefresh().catch((err) =>
    logger.error({ err }, 'Initial OAuth check failed'),
  );

  // Periodic checks
  refreshTimer = setInterval(() => {
    checkAndRefresh().catch((err) =>
      logger.error({ err }, 'Periodic OAuth check failed'),
    );
  }, CHECK_INTERVAL_MS);

  logger.info('OAuth token refresh monitor started');
}

/**
 * Stop the monitor (for graceful shutdown).
 */
export function stopOAuthRefreshMonitor(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
