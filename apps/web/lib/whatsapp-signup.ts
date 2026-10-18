export type SignupEvent =
  | { type: 'finish'; wabaId: string; phoneNumberId: string }
  | { type: 'cancel' | 'error' | 'unsupported' | 'needs_phone_number' };

export function signupWaitingMessage(assets: { code?: string; wabaId?: string; phoneNumberId?: string }, timedOut = false): string {
  if (assets.code && (!assets.wabaId || !assets.phoneNumberId)) {
    return timedOut
      ? 'Meta approved login but did not return WhatsApp number details. Your administrator must check that this configuration uses the WhatsApp Embedded Signup variation, WhatsApp Cloud API product, system-user access token and WhatsApp account assets. Then restart setup.'
      : 'Meta login approved. Finish selecting your WhatsApp business account and Cloud API phone number in the Meta window.';
  }
  if (assets.wabaId && assets.phoneNumberId && !assets.code) {
    return timedOut
      ? 'Meta returned your number but did not finish authorization. Check the HTTPS site in Facebook Login for Business allowed domains and redirect settings, then restart setup.'
      : 'WhatsApp number selected. Finish approving access in the Meta window.';
  }
  return timedOut
    ? 'Meta did not return a completed setup. Close the old window, allow popups for this HTTPS site and restart setup.'
    : 'Complete the secure Meta setup window to connect your business number.';
}

function isFacebookOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'https:'
      && parsed.origin === origin
      && (parsed.hostname === 'facebook.com' || parsed.hostname.endsWith('.facebook.com'));
  } catch {
    return false;
  }
}

export function parseWhatsAppSignupEvent(origin: string, payload: unknown): SignupEvent | null {
  if (!isFacebookOrigin(origin)) return null;
  let value: unknown = payload;
  if (typeof value === 'string') {
    if (value.length > 16_384) return null;
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, unknown>;
  if (event.type !== 'WA_EMBEDDED_SIGNUP') return null;
  const eventName = typeof event.event === 'string' ? event.event.toUpperCase() : '';
  if (eventName === 'CANCEL') return { type: 'cancel' };
  if (eventName === 'ERROR') return { type: 'error' };
  if (eventName !== 'FINISH' && eventName !== 'FINISH_ONLY_WABA') {
    return eventName.startsWith('FINISH') ? { type: 'unsupported' } : null;
  }
  if (!event.data || typeof event.data !== 'object') return { type: 'error' };
  const assets = event.data as Record<string, unknown>;
  if (typeof assets.waba_id !== 'string' || !/^\d{5,30}$/.test(assets.waba_id)) return { type: 'error' };
  if (typeof assets.phone_number_id !== 'string' || !/^\d{5,30}$/.test(assets.phone_number_id)) return { type: 'needs_phone_number' };
  return { type: 'finish', wabaId: assets.waba_id, phoneNumberId: assets.phone_number_id };
}
