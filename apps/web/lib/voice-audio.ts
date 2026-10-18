export const VOICE_SECONDS = 60;
export const VOICE_BYTES = 5 * 1024 * 1024;

/** Canonical PCM WAV avoids sending browser-specific WebM/MP4 containers to the provider. */
export function encodeVoiceWav(samples: Float32Array, sampleRate = 16000): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, index) => { const clamped = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0)); view.setInt16(44 + index * 2, clamped < 0 ? clamped * 32768 : clamped * 32767, true); });
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function prepareVoiceWav(recording: Blob): Promise<Blob> {
  const decoder = new OfflineAudioContext(1, 1, 16000);
  const decoded = await decoder.decodeAudioData(await recording.arrayBuffer());
  if (!Number.isFinite(decoded.duration) || decoded.duration < 0.3) throw new Error('Record between 1 and 60 seconds.');
  const frames = Math.min(decoded.length, VOICE_SECONDS * decoded.sampleRate);
  const mono = new Float32Array(frames);
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const data = decoded.getChannelData(channel);
    for (let i = 0; i < frames; i++) mono[i] += data[i] / decoded.numberOfChannels;
  }
  if (decoded.sampleRate !== 16000) throw new Error('This browser cannot prepare the recording. Please type your question.');
  return encodeVoiceWav(mono);
}
