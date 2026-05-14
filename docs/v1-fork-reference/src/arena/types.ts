/** Shared types for the Model Arena module. */

export interface ArenaBotConfig {
  /** Short stable identifier (e.g. 'deepseek-v3') */
  id: string;
  /** LiteLLM model string (e.g. 'deepseek-v3.2') */
  model: string;
  /** Telegram bot token */
  token: string;
  /** Telegram bot username (without @) — verified via getMe on startup */
  username: string;
  /** Human-readable name shown in responses */
  displayName: string;
  /** Whether this is a local Ollama model */
  local: boolean;
  /** Telegram bot user ID — resolved via getMe on startup */
  telegramUserId?: number;
}

export interface ArenaSession {
  session_id: string;
  user_id: number;
  user_message: string;
  routing_type: 'broadcast' | 'targeted' | 'reply-to';
  targeted_bots: string | null;
  bot_count: number;
  grading_status: 'pending' | 'graded' | 'failed';
  system_prompt_version: string;
  timestamp: string;
}

export interface ArenaLog {
  id: number;
  session_id: string;
  bot_id: string;
  model: string;
  chat_id: number;
  user_id: number;
  telegram_message_id: number | null;
  parent_log_id: number | null;
  prompt_text: string;
  history_json: string;
  response_text: string | null;
  tool_calls_json: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  litellm_request_id: string | null;
  latency_ms: number;
  user_rating: number;
  user_replied: number;
  is_broadcast: number;
  error: string | null;
  timestamp: string;
}

export interface ArenaGrade {
  id?: number;
  arena_log_id: number;
  session_id: string;
  bot_id: string;
  grader_model: string;
  grader_version: string;
  score_total: number;
  score_correctness: number | null;
  score_completeness: number | null;
  score_code_quality: number | null;
  score_clarity: number | null;
  score_tool_efficiency: number | null;
  grade_rationale: string | null;
  graded_at?: string;
}

export interface ArenaAggregate {
  model: string;
  period_type: string;
  period_start: string;
  period_end: string;
  total_sessions: number;
  win_rate: number | null;
  avg_overall_score: number | null;
  avg_cost_per_session: number | null;
  avg_latency_ms: number | null;
  user_rating_ratio: number | null;
  user_reply_rate: number | null;
  tool_call_success_rate: number | null;
  response_count: number | null;
}

export type RoutingType = 'broadcast' | 'targeted' | 'reply-to';

export interface LLMResponse {
  text: string;
  toolCalls?: ToolCallRecord[];
  usage?: { prompt_tokens: number; completion_tokens: number };
  requestId?: string;
}

export interface ToolCallRecord {
  tool_name: string;
  input: unknown;
  output: unknown;
  success: boolean;
  latency_ms: number;
  capability_gap?: boolean;
  error?: string;
}

/** Chat message in OpenAI-compatible format for LiteLLM. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
