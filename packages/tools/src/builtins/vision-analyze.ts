import fs from 'node:fs/promises';
import path from 'node:path';
import type { BuiltinToolResult } from '@anvio/core';

/** Hermes vision_analyze — describe image via OpenAI vision or return path note. */
export async function visionAnalyze(
  imageUrlOrPath: string,
  prompt = 'Describe this image in detail.',
): Promise<BuiltinToolResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      name: 'anvio_tools__vision_analyze',
      output: { imageUrlOrPath, note: 'Set OPENAI_API_KEY for vision analysis' },
      status: 'completed',
    };
  }

  try {
    let imageUrl = imageUrlOrPath;
    if (!imageUrlOrPath.startsWith('http://') && !imageUrlOrPath.startsWith('https://')) {
      const buf = await fs.readFile(path.resolve(imageUrlOrPath));
      const b64 = buf.toString('base64');
      const ext = path.extname(imageUrlOrPath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      imageUrl = `data:${mime};base64,${b64}`;
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.ANVIO_VISION_MODEL ?? 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        max_tokens: 1024,
      }),
    });
    if (!res.ok) {
      return { name: 'anvio_tools__vision_analyze', output: null, status: 'failed', error: `OpenAI vision: HTTP ${res.status}` };
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const analysis = data.choices?.[0]?.message?.content ?? '';
    return {
      name: 'anvio_tools__vision_analyze',
      output: { imageUrlOrPath, analysis },
      status: 'completed',
    };
  } catch (error) {
    return {
      name: 'anvio_tools__vision_analyze',
      output: null,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
