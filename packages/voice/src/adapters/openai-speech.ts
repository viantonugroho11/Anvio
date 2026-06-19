export interface SpeechToTextAdapter {
  transcribe(input: { audioPath?: string; audioBase64?: string; mimeType?: string }): Promise<string>;
}

export interface TextToSpeechAdapter {
  synthesize(text: string): Promise<{ audioBase64: string; mimeType: string }>;
}

export class OpenAiSpeechAdapter implements SpeechToTextAdapter, TextToSpeechAdapter {
  constructor(private readonly apiKey?: string) {}

  private key(): string | undefined {
    return this.apiKey ?? process.env.OPENAI_API_KEY;
  }

  async transcribe(input: { audioPath?: string; audioBase64?: string; mimeType?: string }): Promise<string> {
    const key = this.key();
    if (!key) {
      return '[voice-stub] transcribed text from audio input';
    }

    if (!input.audioPath && !input.audioBase64) {
      throw new Error('audioPath or audioBase64 required');
    }

    const form = new FormData();
    if (input.audioPath) {
      const file = await import('node:fs/promises').then((fs) => fs.readFile(input.audioPath!));
      form.append('file', new Blob([file]), 'audio.wav');
    }
    form.append('model', 'whisper-1');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) throw new Error(`Whisper API failed: ${res.status}`);
    const json = (await res.json()) as { text?: string };
    return json.text ?? '';
  }

  async synthesize(text: string): Promise<{ audioBase64: string; mimeType: string }> {
    const key = this.key();
    if (!key) {
      return { audioBase64: Buffer.from(`[stub-tts:${text.slice(0, 32)}]`).toString('base64'), mimeType: 'text/plain' };
    }

    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'tts-1', input: text, voice: 'alloy' }),
    });
    if (!res.ok) throw new Error(`TTS API failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return { audioBase64: buffer.toString('base64'), mimeType: 'audio/mpeg' };
  }
}
