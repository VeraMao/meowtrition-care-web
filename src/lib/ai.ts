// Writes the summary text with AI when a key is configured; otherwise (or on any failure) falls back
// to the fixed template and SAYS SO via ai_status. Numbers always come from computeMetrics, never from AI.
import type { Cat, Metrics, ReportSummary } from './types'
import { buildPrompt, SYSTEM_PROMPT, templateSummary, validateSummary } from './summary'

export interface AiOptions {
  /** Anthropic key (used first if both are set) */
  apiKey?: string
  model?: string
  /** OpenAI key, used when no Anthropic key is set */
  openaiKey?: string
  openaiModel?: string
  fetchImpl?: typeof fetch
}

/** Ask the configured provider; returns the model's raw text. */
async function askModel(cat: Cat, metrics: Metrics, opts: AiOptions): Promise<{ text: string; model: string }> {
  const f = opts.fetchImpl ?? fetch
  if (opts.apiKey) {
    const model = opts.model || 'claude-haiku-5-5'
    const r = await f('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 1500, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: buildPrompt(cat, metrics) }] }),
    })
    if (!r.ok) throw new Error(`ai_http_${r.status}`)
    const j = await r.json() as { content?: { type: string; text?: string }[] }
    return { text: j.content?.find(c => c.type === 'text')?.text ?? '', model }
  }
  if (!opts.openaiModel) throw new Error('openai_model_not_set')
  const model = opts.openaiModel
  const r = await f('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${opts.openaiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: buildPrompt(cat, metrics) }],
    }),
  })
  if (!r.ok) throw new Error(`ai_http_${r.status}`)
  const j = await r.json() as { choices?: { message?: { content?: string } }[] }
  return { text: j.choices?.[0]?.message?.content ?? '', model }
}

export async function summarize(cat: Cat, metrics: Metrics, opts: AiOptions): Promise<ReportSummary> {
  const template = templateSummary(cat, metrics)
  if (!opts.apiKey && !opts.openaiKey) return { ...template, ai_status: 'not_configured', ai_error: null }
  let model = opts.apiKey ? (opts.model || 'claude-haiku-5-5') : (opts.openaiModel || 'unset')
  try {
    const out = await askModel(cat, metrics, opts)
    model = out.model
    const text = out.text
    const start = text.indexOf('{'), end = text.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('ai_no_json')
    let parsed: unknown
    try { parsed = JSON.parse(text.slice(start, end + 1)) } catch { throw new Error('ai_bad_json') }
    const ok = validateSummary(parsed, metrics, cat)
    return { ...ok, is_mock: false, model, ai_status: 'ai', ai_error: null }
  } catch (err) {
    const reason = (err as Error).message
    return {
      ...template,
      limitations: [...template.limitations, `The AI summary was rejected (${reason}), so this is the template version.`],
      ai_status: 'failed', ai_error: reason,
    }
  }
}
