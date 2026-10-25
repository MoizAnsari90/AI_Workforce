'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { LoaderCircle, Mic, Square, X } from 'lucide-react';
import { useTranslation } from '@/contexts/LanguageContext';
import { workforceRequest, WorkforceRequestError } from '@/lib/workforce-api';
import { prepareVoiceWav, VOICE_BYTES, VOICE_SECONDS } from '@/lib/voice-audio';
import { voiceCompanionState, type CompanionState } from '@/lib/companion';

export type VoiceTranscript = { transcript: string; question: string };
type Stage = 'idle' | 'permission' | 'recording' | 'preparing' | 'ready' | 'uploading';

export function VoiceQuestionControl({ tenantId, disabled, onTranscript, onActivity, onStatusChange }: {
  tenantId?: string; disabled: boolean; onTranscript: (value: VoiceTranscript) => void; onActivity: (busy: boolean) => void; onStatusChange?: (state: CompanionState) => void;
}) {
  const { t } = useTranslation();
  const panelId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [preview, setPreview] = useState('');
  useEffect(() => { onStatusChange?.(voiceCompanionState(stage, !!error)); }, [stage, error, onStatusChange]);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const generation = useRef(0);
  const audio = useRef<Blob | null>(null);
  const objectUrl = useRef('');
  const requestId = useRef('');
  const request = useRef<AbortController | null>(null);
  const locked = useRef(false);
  useEffect(() => {
    if (stage === 'idle') return;
    panel.current?.querySelector<HTMLButtonElement>(stage === 'recording' ? '.wf-voice-actions button' : stage === 'ready' ? '.wf-button-primary' : '.wf-voice-heading button')?.focus();
  }, [stage]);

  function stopTracks() {
    if (timer.current) clearInterval(timer.current); timer.current = null;
    stream.current?.getTracks().forEach(track => { track.onended = null; track.stop(); }); stream.current = null;
  }
  function release() {
    generation.current++;
    request.current?.abort(); request.current = null;
    if (recorder.current?.state === 'recording') recorder.current.stop(); recorder.current = null;
    stopTracks();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = '';
    audio.current = null; requestId.current = ''; locked.current = false;
  }
  useEffect(() => {
    const hidden = () => { if (document.hidden) stop(); };
    const leaving = () => stop();
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', leaving);
    return () => { document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', leaving); release(); };
  }, []);
  function cancel() { release(); setPreview(''); setError(''); setSeconds(0); setStage('idle'); onActivity(false); }
  function dismiss() { cancel(); requestAnimationFrame(() => trigger.current?.focus()); }
  function stop() { if (recorder.current?.state === 'recording') recorder.current.stop(); stopTracks(); }

  async function start() {
    if (disabled || !tenantId || locked.current) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' || typeof OfflineAudioContext === 'undefined') {
      setError('Voice recording requires a supported browser and HTTPS. You can still type your question.'); return;
    }
    release(); const current = generation.current; locked.current = true;
    setError(''); setStage('permission'); onActivity(true);
    try {
      const captured = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }, video: false });
      if (generation.current !== current) { captured.getTracks().forEach(track => track.stop()); return; }
      if (document.hidden) { captured.getTracks().forEach(track => track.stop()); cancel(); return; }
      stream.current = captured;
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      const media = new MediaRecorder(captured, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined);
      recorder.current = media; const chunks: Blob[] = []; let bytes = 0;
      media.ondataavailable = event => { if (generation.current !== current || !event.data.size) return; bytes += event.data.size; if (bytes > VOICE_BYTES) { cancel(); setError('Recording is too large. Record up to 60 seconds.'); return; } chunks.push(event.data); };
      media.onerror = () => { if (generation.current === current) { cancel(); setError('Microphone recording failed. Please try again.'); } };
      media.onstop = async () => {
        if (generation.current !== current) return; stopTracks();
        setStage('preparing');
        try {
          const wav = await prepareVoiceWav(new Blob(chunks, { type: media.mimeType }));
          if (generation.current !== current) return;
          audio.current = wav; requestId.current = crypto.randomUUID(); objectUrl.current = URL.createObjectURL(wav);
          setPreview(objectUrl.current); setStage('ready'); locked.current = false; onActivity(false);
        } catch {
          if (generation.current === current) { cancel(); setError('Recording could not be prepared. Record again or type your question.'); }
        }
      };
      captured.getAudioTracks().forEach(track => { track.onended = stop; });
      media.start(500); setSeconds(0); setStage('recording');
      const started = performance.now();
      timer.current = setInterval(() => { const elapsed = Math.floor((performance.now() - started) / 1000); setSeconds(Math.min(elapsed, VOICE_SECONDS)); if (elapsed >= VOICE_SECONDS) stop(); }, 200);
    } catch (error) {
      if (generation.current !== current) return;
      cancel();
      setError(error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name)
        ? 'Microphone access was denied. Allow it in your browser settings or type your question.'
        : 'Microphone is unavailable. Check your device or type your question.');
    }
  }

  async function transcribe() {
    if (!audio.current || !tenantId || disabled || locked.current) return;
    locked.current = true; setStage('uploading'); setError(''); onActivity(true);
    const current = generation.current; const controller = new AbortController(); request.current = controller;
    try {
      const result = await workforceRequest<VoiceTranscript>(`/api/voice/transcribe?tenantId=${encodeURIComponent(tenantId)}`, {
        method: 'POST', headers: { 'Content-Type': 'audio/wav', 'x-voice-request-id': requestId.current }, body: audio.current,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]),
      });
      if (generation.current !== current) return;
      onTranscript(result); cancel();
    } catch (error) {
      if (generation.current !== current) return;
      locked.current = false; setStage('ready'); onActivity(false);
      setError(error instanceof WorkforceRequestError ? error.message : 'Voice upload could not be confirmed. Retry the same recording or type your question.');
    }
  }

  const active = stage !== 'idle';
  return <>
    <button ref={trigger} className="wf-voice-trigger" type="button" disabled={disabled || !tenantId || active} onClick={() => void start()} aria-label={t('Record a voice question')} title={t('Record a voice question')} aria-expanded={active || !!error} aria-controls={panelId}><Mic size={18} /></button>
    {(active || error) && <div ref={panel} id={panelId} className="wf-voice-panel" role="group" aria-label={t('Voice question')} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); } }}>
      <div className="wf-voice-heading"><strong>{t('Voice question')}</strong><button className="wf-icon-button" type="button" onClick={dismiss} aria-label={t('Cancel recording')}><X size={16} /></button></div>
      <p role="status" aria-live="polite">{t(stage === 'permission' ? 'Allow microphone access to start recording.' : stage === 'recording' ? 'Recording…' : stage === 'preparing' ? 'Preparing recording…' : stage === 'uploading' ? 'Transcribing your recording…' : 'Preview your recording, then convert it to text.')}</p>
      {stage === 'recording' && <div className="wf-voice-actions"><span className="wf-voice-timer" aria-label={t('Recording time')}>{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')} / 01:00</span><button type="button" className="wf-button wf-button-secondary" onClick={stop}><Square size={14} />{t('Stop recording')}</button></div>}
      {preview && <audio controls src={preview} preload="metadata" aria-label={t('Recording preview')} />}
      {stage === 'ready' && <div className="wf-voice-actions"><button type="button" className="wf-button wf-button-secondary" onClick={dismiss}>{t('Discard recording')}</button><button type="button" disabled={disabled} className="wf-button wf-button-primary" onClick={() => void transcribe()}>{t('Use recording')}</button></div>}
      {['permission', 'preparing', 'uploading'].includes(stage) && <LoaderCircle className="wf-spin" size={18} aria-hidden="true" />}
      {error && <p className="wf-inline-error" role="alert">{t(error)}</p>}
      <small>{t('Up to 60 seconds. Audio is sent for transcription only when you choose Use recording.')}</small>
    </div>}
  </>;
}
