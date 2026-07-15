import fetch from 'node-fetch';
import { OPENROUTER_API_KEY, OPENROUTER_MODEL } from './config.js';

/**
 * Sends a prompt to OpenRouter and returns the generated response.
 * Uses the Chat Completion endpoint.
 */
export async function getResponseFromLLM(prompt: string): Promise<string> {
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const body = {
    model: OPENROUTER_MODEL,
    messages: [{ role: 'user', content: prompt }],
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${txt}`);
  }
  const data: any = await response.json();
  const content = data.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}
