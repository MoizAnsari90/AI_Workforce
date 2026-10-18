export type CompanionState = 'ready' | 'listening' | 'thinking' | 'answered' | 'error';

export function voiceCompanionState(stage: string, error: boolean): CompanionState {
  if (error) return 'error';
  if (stage === 'recording') return 'listening';
  if (stage === 'preparing' || stage === 'uploading') return 'thinking';
  return 'ready';
}

export function assistantCompanionState(asking: boolean, voice: CompanionState, latest?: { answer?: string; error?: string }): CompanionState {
  if (asking) return 'thinking';
  if (voice !== 'ready') return voice;
  if (latest?.error) return 'error';
  return latest?.answer ? 'answered' : 'ready';
}
