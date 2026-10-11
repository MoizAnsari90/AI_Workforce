export type SignupEvent = { type: 'finish'; wabaId: string; phoneNumberId: string } | { type: 'cancel' | 'error' | 'unsupported' };

export function parseWhatsAppSignupEvent(origin: string, payload: unknown): SignupEvent | null {
  if (!['https://www.facebook.com', 'https://web.facebook.com', 'https://facebook.com'].includes(origin)) return null;
  let value: unknown = payload;
  if (typeof value === 'string') {
    if (value.length > 16_384) return null;
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, unknown>;
  if (event.type !== 'WA_EMBEDDED_SIGNUP') return null;
  if (event.event === 'CANCEL') return { type: 'cancel' };
  if (event.event === 'ERROR') return { type: 'error' };
  if (event.event !== 'FINISH') {
    return typeof event.event === 'string' && event.event.startsWith('FINISH') ? { type: 'unsupported' } : null;
  }
  if (!event.data || typeof event.data !== 'object') return { type: 'error' };
  const assets = event.data as Record<string, unknown>;
  if (typeof assets.waba_id !== 'string' || !/^\d{5,30}$/.test(assets.waba_id) || typeof assets.phone_number_id !== 'string' || !/^\d{5,30}$/.test(assets.phone_number_id)) return { type: 'error' };
  return { type: 'finish', wabaId: assets.waba_id, phoneNumberId: assets.phone_number_id };
}
