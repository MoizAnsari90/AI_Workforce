import { z } from 'zod';
import { hasSubscription } from './subscriptionService';
import { hasActiveChannelAgent } from './agentActivationService';
import { prisma } from '../lib/prisma';
import { AppError } from '../errors/AppError';
import { isEmergencyMessage } from './emergencyClassifier';
import { createAppointment, dateInput, decryptAppointmentContact, nicheAvailability, saveNicheLead, syncAppointment } from './nicheWorkflowService';
import { customerHash, enqueueNicheDispatch, getAutomationConfig, normalizePhone, openAutomationData, sealAutomationData, stableUuid, type AutomationConfig } from './nicheAutomationStore';

type Choice = { id: string; label: string };
export type NicheConversationState = { phone: string; name?: string; stage: string; choices?: Choice[]; resourceId?: string; serviceId?: string; propertyId?: string; leadId?: string; date?: string; start?: string; bookingKey?: string; bookingId?: string; lastReply?: string; lastCustomerMessage?: string; flowKind?: string; qualification?: { purpose: 'buy' | 'rent' | null; city: string | null; area: string | null; propertyType: 'house' | 'apartment' | 'commercial' | 'land' | null; budget: number | null; timeline: 'within_month' | 'within_quarter' | 'later' | 'unknown'; funding: 'ready' | 'needs_financing' | 'unknown' } };
type Turn = { text: string; phone: string; messageId: string; channel: 'whatsapp' | 'voice'; receivedAt: string };
const ask = ['Are you looking to buy or rent? Reply BUY or RENT.', 'Which city?', 'Which area?', 'Which property type: house, apartment, commercial or land?', 'What is your maximum budget in the business currency? For rent, give a monthly amount.', 'Timeline: 1 = within a month, 2 = within three months, 3 = later.', 'Funding: 1 = budget ready, 2 = needs financing.'];
const menu = (choices: Choice[]) => choices.map((item, i) => `${i + 1}. ${item.label}`).join('\n');
function selected(state: NicheConversationState, text: string) { const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 }; const number = words[text.toLowerCase()] || Number(text); return Number.isInteger(number) ? state.choices?.[number - 1] : undefined; }
const formattedTime = (date: string, timezone: string) => new Intl.DateTimeFormat('en', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));
async function doctorMenu(tenantId: string, config: AutomationConfig, state: NicheConversationState) {
  const resources = await prisma.bookingResource.findMany({ where: { tenantId, kind: config.kind, active: true }, orderBy: { name: 'asc' }, take: 8 });
  state.choices = resources.map(item => ({ id: item.id, label: item.name })); state.stage = 'resource';
  return resources.length ? `Choose ${config.kind === 'healthcare' ? 'a doctor' : 'a viewing agent'} by number:\n${menu(state.choices)}` : 'No appointment resources are available. Reply HUMAN for staff assistance.';
}
async function advance(tenantId: string, config: AutomationConfig, state: NicheConversationState, turn: Turn): Promise<string> {
  const text = turn.text.trim(); const command = text.toLowerCase();
  if (command === 'call' && turn.channel === 'whatsapp') {
    if (!config.voiceEnabled) return 'Voice callbacks are not enabled. Reply HUMAN for staff assistance.';
    await enqueueNicheDispatch(tenantId, `callback:${turn.messageId}`, 'voice_call', { phone: state.phone, consentAt: new Date().toISOString(), sessionHash: customerHash(state.phone) }, undefined, config.kind);
    return 'You requested an AI voice callback to this WhatsApp number. The call is queued; reply STOP to stop further automation.';
  }
  if (command === 'remind' && state.bookingId) {
    if (!config.remindersEnabled) return 'WhatsApp reminders are not enabled for this business.';
    const booking = await prisma.scheduledAppointment.findFirst({ where: { id: state.bookingId, tenantId, status: 'confirmed' } });
    if (!booking || decryptAppointmentContact(booking.encryptedContact, tenantId).phone !== state.phone) return 'A confirmed appointment on this number is required for reminders.';
    await prisma.scheduledAppointment.update({ where: { id: booking.id }, data: { reminderConsent: true } });
    return 'You have opted in to a WhatsApp reminder for this appointment. Reply STOP at any time to opt out.';
  }
  if (command === 'status' && state.bookingId) {
    const status = await syncAppointment(tenantId, 'receptionist', config.kind, state.bookingId);
    return `Appointment status: ${status.status.replace(/_/g, ' ')}.${status.status === 'confirmed' && config.remindersEnabled ? ' Reply REMIND to opt in to a WhatsApp reminder.' : ''}`;
  }
  if (command === 'cancel' && state.bookingId) { state.stage = 'cancel_confirm'; return 'Reply CANCEL YES to cancel your last appointment, or NO to keep it.'; }
  if (state.stage === 'cancel_confirm') {
    if (command === 'cancel yes') { const status = await syncAppointment(tenantId, 'receptionist', config.kind, state.bookingId!, true); state.stage = 'done'; return `Appointment status: ${status.status.replace(/_/g, ' ')}. Reply STATUS to check again.`; }
    if (command === 'no') { state.stage = 'done'; return 'Your cancellation was not requested.'; }
    return 'Reply CANCEL YES to cancel, or NO to keep the appointment.';
  }
  if (state.stage === 'welcome') { state.stage = 'consent'; return 'Hello! I am the automated reception assistant. I can collect your contact details and preferences for booking. Please do not send medical histories or sensitive documents. Reply AGREE to continue, or HUMAN for staff. Reply STOP to stop automation.'; }
  if (state.stage === 'consent') {
    if (!['agree', 'yes', 'haan', 'han'].includes(command)) return 'Reply AGREE to continue with automated booking, or HUMAN for staff.';
    state.stage = 'name'; return 'What name should we use for your booking?';
  }
  if (state.stage === 'name') {
    if (text.length < 2 || text.length > 120) return 'Please enter a name between 2 and 120 characters.';
    state.name = text;
    if (config.kind === 'healthcare') return doctorMenu(tenantId, config, state);
    state.qualification = { purpose: null, city: null, area: null, propertyType: null, budget: null, timeline: 'unknown', funding: 'unknown' }; state.stage = 'qualification_0'; return ask[0];
  }
  if (state.stage.startsWith('qualification_')) {
    const step = Number(state.stage.split('_')[1]); const q = state.qualification!;
    if (step === 0) { if (!['buy', 'rent'].includes(command)) return ask[0]; q.purpose = command as 'buy' | 'rent'; }
    if (step === 1 || step === 2) { if (text.length < 2 || text.length > 120) return ask[step]; q[step === 1 ? 'city' : 'area'] = text; }
    if (step === 3) { if (!['house', 'apartment', 'commercial', 'land'].includes(command)) return ask[3]; q.propertyType = command as 'house'; }
    if (step === 4) { const budget = Number(text.replace(/,/g, '')); if (!Number.isFinite(budget) || budget <= 0 || budget > 9999999999999.99) return ask[4]; q.budget = Math.round(budget * 100) / 100; }
    if (step === 5) { const answer = ({ '1': 'within_month', '2': 'within_quarter', '3': 'later' } as const)[text as '1']; if (!answer) return ask[5]; q.timeline = answer; }
    if (step === 6) { if (!['1', '2'].includes(text)) return ask[6]; q.funding = text === '1' ? 'ready' : 'needs_financing'; }
    if (step < 6) { state.stage = `qualification_${step + 1}`; return ask[step + 1]; }
    const existing = await prisma.lead.findFirst({ where: { tenantId, source: 'real_estate', phone: state.phone }, orderBy: { createdAt: 'desc' } });
    const result = await saveNicheLead(tenantId, 'receptionist', { name: state.name, phone: state.phone, qualification: q }, state.leadId || existing?.id);
    state.leadId = result.lead.id; state.choices = result.matches.slice(0, 8).map(item => ({ id: item.id, label: `${item.reference}: ${item.title}, ${item.currency} ${item.price}${item.purpose === 'rent' ? ' / month' : ''}` })); state.stage = 'property';
    return state.choices.length ? `These saved listings match your preferences. Select a number to arrange a viewing:\n${menu(state.choices)}` : 'Your preferences are saved. No current listings match. Reply HUMAN for staff help or START to change preferences.';
  }
  if (state.stage === 'property') { const choice = selected(state, text); if (!choice) return `Select a property number, or HUMAN.\n${menu(state.choices || [])}`; state.propertyId = choice.id; return doctorMenu(tenantId, config, state); }
  if (state.stage === 'resource') {
    const choice = selected(state, text); if (!choice) return `Please select a number.\n${menu(state.choices || [])}`;
    state.resourceId = choice.id;
    if (config.kind === 'healthcare') { const services = await prisma.clinicService.findMany({ where: { tenantId, resourceId: choice.id, active: true }, take: 8, orderBy: { name: 'asc' } }); state.choices = services.map(item => ({ id: item.id, label: `${item.name} (${item.durationMinutes} minutes)` })); state.stage = 'service'; return services.length ? `Select a service number:\n${menu(state.choices)}` : 'No services are available for this doctor. Reply START or HUMAN.'; }
    state.stage = 'date'; return 'Which date? Use YYYY-MM-DD, for example 2030-01-07.';
  }
  if (state.stage === 'service') { const choice = selected(state, text); if (!choice) return `Please select a service number.\n${menu(state.choices || [])}`; state.serviceId = choice.id; state.stage = 'date'; return 'Which date? Use YYYY-MM-DD.'; }
  if (state.stage === 'date') {
    if (!dateInput.safeParse(text).success) return 'Please use a real date in YYYY-MM-DD format.';
    const available = await nicheAvailability(tenantId, config.kind, state.resourceId!, text, state.serviceId);
    state.date = text; state.choices = available.slots.slice(0, 8).map(item => ({ id: item.start, label: formattedTime(item.start, available.timezone) }));
    if (!state.choices.length) return 'No available times on that date. Please send another date, or HUMAN.';
    state.stage = 'slot'; return `Select an available time by number (${available.timezone}):\n${menu(state.choices)}`;
  }
  if (state.stage === 'slot') { const choice = selected(state, text); if (!choice) return `Please choose a time number.\n${menu(state.choices || [])}`; state.start = choice.id; state.bookingKey = stableUuid(`${tenantId}:${turn.channel}:${turn.messageId}`); state.stage = 'confirm'; return `Confirm ${choice.label} for ${state.name}? Reply YES to book, or NO to choose another date.`; }
  if (state.stage === 'confirm') {
    if (['no', 'nahi'].includes(command)) { state.stage = 'date'; return 'Please send a new date in YYYY-MM-DD format.'; }
    if (!['yes', 'haan', 'han'].includes(command)) return 'No appointment has been requested. Reply YES to book or NO to change the date.';
    const result = await createAppointment(tenantId, 'receptionist', config.kind, { resourceId: state.resourceId, ...(config.kind === 'healthcare' ? { serviceId: state.serviceId } : { propertyId: state.propertyId, leadId: state.leadId }), start: state.start, contact: { name: state.name, phone: state.phone }, idempotencyKey: state.bookingKey });
    state.bookingId = result.id; state.stage = 'done';
    return result.status === 'confirmed' ? `Your appointment is confirmed. Reply CANCEL to cancel or STATUS to check.${config.remindersEnabled ? ' Reply REMIND to opt in to a WhatsApp reminder.' : ''}` : `Appointment ${result.status.replace(/_/g, ' ')}. It is not confirmed yet. Reply STATUS to check; do not book a second appointment.`;
  }
  return 'Reply STATUS to check your appointment, CANCEL to cancel, START for a new enquiry, or HUMAN for staff.';
}

export async function processNicheTurn(tenantId: string, raw: Turn) {
  const turn = z.object({ text: z.string().min(1).max(4096), phone: z.string(), messageId: z.string().min(1).max(200), channel: z.enum(['whatsapp', 'voice']), receivedAt: z.iso.datetime({ offset: true }) }).parse(raw);
  turn.phone = normalizePhone(turn.phone);
  const config = await getAutomationConfig(tenantId); if (!config) return { reply: '', paused: true };
  const subscribed = await hasSubscription(tenantId);
  const agentActive = await hasActiveChannelAgent(tenantId, config.kind);
  const hash = customerHash(turn.phone); const receiptKey = `turn:${turn.channel}:${turn.messageId}`;
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`session:${tenantId}:${hash}`}))`;
    const receipt = await tx.nicheDispatch.findUnique({ where: { tenantId_key: { tenantId, key: receiptKey } } });
    if (receipt) return openAutomationData<{ reply: string; paused: boolean }>(receipt.encryptedPayload, tenantId);
    const existing = await tx.nicheSession.findUnique({ where: { tenantId_channel_customerHash: { tenantId, channel: turn.channel, customerHash: hash } } });
    let state: NicheConversationState = existing ? openAutomationData(existing.encryptedState, tenantId) : { phone: turn.phone, stage: 'welcome' };
    const previousKind = state.flowKind;
    if (previousKind && previousKind !== config.kind) state = { phone: turn.phone, stage: 'welcome' };
    let paused = existing?.paused || false; let optedOut = existing?.optedOut || false; let reason = existing?.handoffReason || null; let reply = '';
    const globalStop = await tx.nicheSession.findFirst({ where: { tenantId, customerHash: hash, optedOut: true } });
    if (globalStop) { paused = true; optedOut = true; reason = 'opt_out'; }
    const command = turn.text.trim().toLowerCase();
    if (command === 'stop') { paused = true; optedOut = true; reason = 'opt_out'; await tx.nicheSession.updateMany({ where: { tenantId, customerHash: hash }, data: { paused: true, optedOut: true, handoffReason: 'opt_out' } }); reply = 'Automation and reminders stopped for this number. Reply START if you want to opt in again.'; }
    else if (['human', 'staff', 'insan'].includes(command)) { paused = true; reason = 'customer_requested_staff'; reply = 'Your request is in the staff inbox. Automated replies are paused. Please contact the business directly if urgent.'; }
    else if (!subscribed) { paused = true; reason = 'subscription_required'; }
    else if (!agentActive) { paused = true; reason = 'agent_inactive'; }
    else if (config.kind === 'healthcare' && isEmergencyMessage(turn.text)) { paused = true; reason = 'urgent_handoff'; reply = 'This assistant cannot assess emergencies. Contact local emergency services or seek urgent medical help now. Do not wait for this inbox.'; }
    else if (config.kind === 'healthcare' && /\b(diagnos\w*|prescri\w*|symptom\w*|medicine|medication|treatment|medical advice|dawai|dawa|ilaaj)\b/i.test(turn.text)) { paused = true; reason = 'clinical_question'; reply = 'I can help with scheduling only. Please ask a qualified clinician about medical concerns. Your request has been flagged for staff.'; }
    else {
      if (command === 'start' && (!paused || optedOut)) { state = { phone: turn.phone, stage: 'welcome' }; paused = false; optedOut = false; reason = null; await tx.nicheSession.updateMany({ where: { tenantId, customerHash: hash, optedOut: true }, data: { optedOut: false } }); }
      if (!paused && (turn.channel === 'whatsapp' ? config.whatsappEnabled : config.voiceEnabled)) {
        try { reply = await advance(tenantId, config, state, turn); }
        catch (error) { if (!(error instanceof AppError)) throw error; reply = 'The requested action could not be verified. Please try again or reply HUMAN. No success is being confirmed.'; }
      }
    }
    state.lastCustomerMessage = turn.text;
    state.lastReply = reply || state.lastReply;
    const encryptedState = sealAutomationData({ ...state, flowKind: config.kind }, tenantId, config.kind);
    const session = await tx.nicheSession.upsert({ where: { tenantId_channel_customerHash: { tenantId, channel: turn.channel, customerHash: hash } }, create: { tenantId, channel: turn.channel, customerHash: hash, encryptedState, paused, optedOut, handoffReason: reason }, update: { encryptedState, paused, optedOut, handoffReason: reason } });
    await tx.nicheDispatch.create({ data: { tenantId, key: receiptKey, type: 'turn_receipt', status: 'succeeded', encryptedPayload: sealAutomationData({ reply, paused }, tenantId, config.kind) } });
    if (reply && turn.channel === 'whatsapp') await tx.nicheDispatch.create({ data: { tenantId, key: `reply:${turn.messageId}`, type: 'whatsapp_reply', encryptedPayload: sealAutomationData({ phone: turn.phone, text: reply, receivedAt: turn.receivedAt, controlReply: paused }, tenantId, config.kind) } });
    if (paused) await tx.auditLog.create({ data: { tenantId, actorType: 'system', actorId: 'receptionist', operation: 'receptionist_handoff', entityType: 'niche_session', entityId: session.id, newValue: JSON.stringify({ reason }) } });
    return { reply, paused };
  }, { timeout: 120_000, maxWait: 20_000 });
}
