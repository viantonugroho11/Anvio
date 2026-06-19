import { OpenAiSpeechAdapter } from './adapters/openai-speech.js';

export interface VoiceTurnResult {
  transcript: string;
  responseText: string;
  audioBase64?: string;
  mimeType?: string;
}

export class VoicePipeline {
  constructor(private readonly adapter = new OpenAiSpeechAdapter()) {}

  async transcribe(audioPath: string): Promise<string> {
    return this.adapter.transcribe({ audioPath });
  }

  async transcribeBuffer(buffer: Buffer, mimeType = 'audio/ogg'): Promise<string> {
    return this.adapter.transcribe({
      audioBase64: buffer.toString('base64'),
      mimeType,
    });
  }

  async speak(text: string): Promise<{ audioBase64: string; mimeType: string }> {
    return this.adapter.synthesize(text);
  }

  async turn(audioPath: string, respond: (transcript: string) => Promise<string>): Promise<VoiceTurnResult> {
    const transcript = await this.transcribe(audioPath);
    const responseText = await respond(transcript);
    const audio = await this.speak(responseText);
    return { transcript, responseText, audioBase64: audio.audioBase64, mimeType: audio.mimeType };
  }
}

export { OpenAiSpeechAdapter };
