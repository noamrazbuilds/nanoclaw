/**
 * Claude provider container config — only registered when the user has
 * configured a custom Anthropic-compatible endpoint via setup. Setup
 * appends `import './claude.js'` to providers/index.ts at that point;
 * standard installs hitting api.anthropic.com don't need this file
 * loaded.
 *
 * The real auth token never enters the container. Setup creates an
 * OneCLI generic secret (host-pattern = base URL hostname, header-name
 * = Authorization, value-format = "Bearer {value}") so the proxy
 * rewrites the Authorization header on the wire. The container only
 * needs:
 *   - ANTHROPIC_BASE_URL — so the SDK knows where to call
 *   - ANTHROPIC_AUTH_TOKEN=placeholder — so the SDK adds an
 *     Authorization: Bearer header for OneCLI to overwrite
 */
import { DEFAULT_FALLBACK_MODELS } from '../config.js';
import { readEnvFile } from '../env.js';
import { registerProviderContainerConfig } from './provider-container-registry.js';

registerProviderContainerConfig('claude', () => {
  const dotenv = readEnvFile(['ANTHROPIC_BASE_URL']);
  const env: Record<string, string> = {};
  if (dotenv.ANTHROPIC_BASE_URL) {
    env.ANTHROPIC_BASE_URL = dotenv.ANTHROPIC_BASE_URL;
    env.ANTHROPIC_AUTH_TOKEN = 'placeholder';
    // C1 credit-error fallback CHAIN. Only meaningful alongside a custom
    // ANTHROPIC_BASE_URL (the user's LiteLLM proxy) — that's what makes a
    // non-Anthropic fallback like gemini/gpt reachable. The agent-runner reads
    // NANOCLAW_FALLBACK_MODELS (ordered, comma-separated) and re-runs on each in
    // turn when Anthropic credits are exhausted; NANOCLAW_FALLBACK_MODEL (first
    // entry) is kept for back-compat. Absent → no fallback attempted.
    if (DEFAULT_FALLBACK_MODELS) {
      env.NANOCLAW_FALLBACK_MODELS = DEFAULT_FALLBACK_MODELS;
      env.NANOCLAW_FALLBACK_MODEL = DEFAULT_FALLBACK_MODELS.split(',')[0];
    }
  }
  return { env };
});
