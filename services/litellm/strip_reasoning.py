"""
LiteLLM pre-call hook: strip 'reasoning' from requests to non-reasoning OpenAI models.

LiteLLM translates Anthropic thinking params to OpenAI's nested `reasoning: {effort: ...}`
object but then fails to drop it for non-reasoning models (gpt-4o, gpt-4o-mini etc)
because the drop_params check uses underscore (reasoning_effort) while the actual
field sent is dot-notation (reasoning.effort) — a naming mismatch.

Exported as an instance (StripReasoningHook) so LiteLLM's getattr() call gets a
bound object rather than an uninstantiated class, which would cause "missing self" errors.
"""

from litellm.integrations.custom_logger import CustomLogger

NON_REASONING_OPENAI_MODELS = {
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4o-2024-11-20",
    "gpt-4o-2024-08-06",
    "gpt-4o-mini-2024-07-18",
    "openai/gpt-4o",
    "openai/gpt-4o-mini",
}


class _StripReasoningHook(CustomLogger):
    async def async_pre_call_hook(self, user_api_key_dict, cache, data, call_type):
        model = data.get("model", "")
        if model in NON_REASONING_OPENAI_MODELS:
            data.pop("reasoning", None)
            if "optional_params" in data:
                data["optional_params"].pop("reasoning", None)
                data["optional_params"].pop("reasoning_effort", None)
        return data


# Export instance so LiteLLM's getattr() gets a bound object, not an uninstantiated class
StripReasoningHook = _StripReasoningHook()
