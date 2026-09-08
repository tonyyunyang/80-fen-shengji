# Token Plan models and price references

Verified 2026-09-08 against Alibaba's [Token Plan model list](https://www.alibabacloud.com/help/en/model-studio/token-plan-personal-overview) and [Singapore price tables](https://www.alibabacloud.com/help/en/model-studio/model-pricing). The selector contains the nine listed models suitable for text input and function calls. Vision-capable Qwen models remain suitable when used only with text. Image, speech, audio, and video generators are excluded, as are general Model Studio models not listed for this Token Plan.

## Rates shown in the selector

Prices are **USD per million tokens**, input and output separately. These are standard API comparisons, **not actual Token Plan Credit charges**. Comparisons use compact prompts and the busy-hour rate where applicable; caching and separate promotions are excluded.

| Model ID | Input | Output | Additional price band |
| --- | ---: | ---: | --- |
| `qwen3.8-flash` | $0.15 | $0.47 | — |
| `qwen3.8-max` | $2.00 | $6.00 | — |
| `qwen3.7-plus` | $0.40 | $1.60 | Above 256K input: $1.20 / $4.80 |
| `qwen3.7-max` | $2.50 | $7.50 | — |
| `qwen3.6-flash` | $0.25 | $1.50 | Above 256K input: $1.00 / $4.00 |
| `deepseek-v4-pro-0813` | $1.32 | $3.96 | Idle hours: $0.66 / $1.98 |
| `deepseek-v4-pro` | $2.40 | $4.80 | — |
| `deepseek-v4-flash-0731` | $0.44 | $1.32 | Idle hours: $0.22 / $0.66 |
| `glm-5.2` | $1.40 | $4.40 | — |

Alibaba determines Token Plan Credits dynamically from the model, tokens, thinking, and tools. Published subscription promotions are separate from these standard API rates; do not multiply discounts together to invent an actual Credit cost. The UI links to the provider's current pages and displays the verification date.

`src/model-catalog.js` is the shared source for the picker, model-specific request options, and reference estimates. The meter estimates these compact game requests up to 128,000 reported input tokens, comfortably below the listed context-price boundaries. Larger or unknown-model usage receives no estimate until appropriate pricing is configured. Missing usage remains unknown. Variable-price models use their busy-hour reference rate, not an asserted current charge.

## Compatibility and validation

Use **Alibaba Token Plan** in API connections for the built-in list. Enter a key belonging to that account and choose the corresponding connection per seat. All models on that connection use its Chat Completions endpoint.

All catalog profiles request non-thinking mode, disable parallel tool calls, and cap the complete output with `max_completion_tokens`. Qwen and GLM force the current function; DeepSeek uses automatic tool selection plus the game's tool-only instruction. Every response must still contain exactly one valid tool action. Qwen disables preserved thinking. GLM uses `clear_thinking:true` and `tool_stream:true` with a complete, non-streaming response; its model documentation confirms that tool arguments are returned in full in this mode. Sources: [Chat parameters](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions), [function calling](https://www.alibabacloud.com/help/en/model-studio/qwen-function-calling), [GLM](https://www.alibabacloud.com/help/en/model-studio/glm), [DeepSeek](https://www.alibabacloud.com/help/en/model-studio/deepseek-api).

The built-in catalog is covered by offline request/response fixtures. It is a dated convenience list, not a promise of account entitlement. Users can add explicit models and their reference prices to their own connection. Custom entries are not automatically capability-verified.

The web UI uses each browser session's own key. Native OpenAI Responses, Anthropic Messages and other chat-compatible gateways can be configured separately. Saving a connection does not send a paid probe. CLI probes remain optional; see [live evaluations](live-api-testing.md).
