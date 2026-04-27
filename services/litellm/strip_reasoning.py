"""
LiteLLM pre-call hook: strip 'reasoning' from requests to non-reasoning OpenAI models.

LiteLLM translates Anthropic thinking params to OpenAI's `reasoning: {effort: ...}`
object but then fails to drop it for non-reasoning models (gpt-4o, gpt-4o-mini etc)
because the drop_params logic checks for flat `reasoning_effort` while the actual
field added is the nested `reasoning` object — a naming mismatch.
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


class StripReasoningHook(CustomLogger):
    async def async_pre_call_hook(self, user_api_key_dict, cache, data, call_type):
        model = data.get("model", "")
        if model in NON_REASONING_OPENAI_MODELS:
            data.pop("reasoning", None)
            if "optional_params" in data:
                data["optional_params"].pop("reasoning", None)
                data["optional_params"].pop("reasoning_effort", None)
        return data
