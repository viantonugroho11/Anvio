import fs from 'node:fs/promises';
import path from 'node:path';
import type { BuiltinToolResult } from '@anvio/core';
import { OpenAiSpeechAdapter } from '@anvio/voice';

export async function imageGenerate(
  prompt: string,
  options: { workspaceRoot?: string; size?: string } = {},
): Promise<BuiltinToolResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      name: 'anvio_tools__image_generate',
      output: { prompt, note: 'Set OPENAI_API_KEY for DALL-E image generation' },
      status: 'completed',
    };
  }

  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: options.size ?? '1024x1024',
      }),
    });
    if (!res.ok) {
      return {
        name: 'anvio_tools__image_generate',
        output: null,
        status: 'failed',
        error: `OpenAI images API: HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as { data?: Array<{ url?: string; revised_prompt?: string }> };
    const item = data.data?.[0];
    let savedPath: string | undefined;
    if (item?.url && options.workspaceRoot) {
      const imgRes = await fetch(item.url);
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      const dir = path.join(options.workspaceRoot, 'artifacts', 'images');
      await fs.mkdir(dir, { recursive: true });
      const filename = `generated-${Date.now()}.png`;
      savedPath = path.join(dir, filename);
      await fs.writeFile(savedPath, buffer);
    }
    return {
      name: 'anvio_tools__image_generate',
      output: {
        prompt,
        revisedPrompt: item?.revised_prompt,
        url: item?.url,
        savedPath,
      },
      status: 'completed',
    };
  } catch (error) {
    return {
      name: 'anvio_tools__image_generate',
      output: null,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function textToSpeech(
  text: string,
  options: { workspaceRoot?: string; voice?: string } = {},
): Promise<BuiltinToolResult> {
  try {
    const adapter = new OpenAiSpeechAdapter();
    const audio = await adapter.synthesize(text);
    let savedPath: string | undefined;
    if (options.workspaceRoot && audio.mimeType !== 'text/plain') {
      const dir = path.join(options.workspaceRoot, 'artifacts', 'audio');
      await fs.mkdir(dir, { recursive: true });
      const ext = audio.mimeType.includes('mpeg') ? 'mp3' : 'bin';
      savedPath = path.join(dir, `tts-${Date.now()}.${ext}`);
      await fs.writeFile(savedPath, Buffer.from(audio.audioBase64, 'base64'));
    }
    return {
      name: 'anvio_tools__text_to_speech',
      output: {
        text: text.slice(0, 200),
        mimeType: audio.mimeType,
        audioBase64: audio.audioBase64.slice(0, 80) + (audio.audioBase64.length > 80 ? '…' : ''),
        savedPath,
      },
      status: 'completed',
    };
  } catch (error) {
    return {
      name: 'anvio_tools__text_to_speech',
      output: null,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
