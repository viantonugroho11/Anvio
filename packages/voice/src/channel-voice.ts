import type { VoicePipeline } from './pipeline.js';

export interface ChannelVoiceOptions {
  enabled?: boolean;
  replyWithAudio?: boolean;
}

export interface ChannelVoiceDeps {
  voice?: ChannelVoiceOptions;
  pipeline?: VoicePipeline;
}

/** Returns true when voice inbound should be transcribed before dispatching to the agent. */
export function isChannelVoiceEnabled(deps: ChannelVoiceDeps): boolean {
  return deps.voice?.enabled === true && Boolean(deps.pipeline);
}

export async function transcribeInboundAudio(
  pipeline: VoicePipeline,
  audio: Buffer,
  mimeType = 'audio/ogg',
): Promise<string> {
  return pipeline.transcribeBuffer(audio, mimeType);
}

export function voiceInboundContent(transcript: string): string {
  const trimmed = transcript.trim();
  return trimmed ? `[voice] ${trimmed}` : '[voice] (empty transcript)';
}
