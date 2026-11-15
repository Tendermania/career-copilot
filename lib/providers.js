// AI providers. Claude uses Anthropic's SDK. Every other provider speaks the
// OpenAI-compatible chat-completions API, so one code path serves them all.
export const COMPAT = {
  deepseek: { label: "DeepSeek", base: "https://api.deepseek.com", model: "deepseek-v4-flash", help: "https://platform.deepseek.com/api_keys", note: "Per DeepSeek's privacy policy, what you send (your resume, job text) is processed and stored on servers in China." },
  openai: { label: "OpenAI (ChatGPT)", base: "https://api.openai.com/v1", model: "gpt-4o-mini", help: "https://platform.openai.com/api-keys", note: "" },
  gemini: { label: "Google Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash", help: "https://aistudio.google.com/apikey", note: "" },
  openrouter: { label: "OpenRouter (any model)", base: "https://openrouter.ai/api/v1", model: "openrouter/auto", help: "https://openrouter.ai/keys", note: "One key for hundreds of models. Put any model name from openrouter.ai/models in the Model box." },
  groq: { label: "Groq", base: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", help: "https://console.groq.com/keys", note: "" },
  mistral: { label: "Mistral", base: "https://api.mistral.ai/v1", model: "mistral-small-latest", help: "https://console.mistral.ai/api-keys", note: "" },
  xai: { label: "xAI (Grok)", base: "https://api.x.ai/v1", model: "grok-3-mini", help: "https://console.x.ai", note: "" },
  custom: { label: "Custom / local (OpenAI-compatible)", base: "", model: "", help: "", note: "For Ollama (http://localhost:11434/v1), LM Studio, Together, Fireworks, Azure and anything else that speaks the OpenAI chat-completions API. The key can stay empty for local models." },
};

/** Settings keys for one compatible provider. */
export const fieldsFor = (id) => ({ key: `${id}ApiKey`, model: `${id}Model`, base: `${id}BaseUrl` });

/** Public list for the UI. */
export const providerList = () => [
  { id: "claude", label: "Claude (Anthropic)", help: "https://console.anthropic.com/settings/keys", webSearch: true, note: "" },
  ...Object.entries(COMPAT).map(([id, p]) => ({ id, label: p.label, help: p.help, model: p.model, base: p.base, webSearch: false, note: p.note, custom: id === "custom" })),
];
