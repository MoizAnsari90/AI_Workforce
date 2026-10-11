import { prisma } from '../lib/prisma';
import { IntegrationService } from './integrationService';
import { businessProfileSchema } from './businessProfileService';
import { getCalendarStatus } from './googleCalendarService';
import { hasRecentWhatsAppDeliveryProof } from './whatsappSetupTestService';

export type WorkspaceIndustry = 'ecommerce' | 'real_estate' | 'healthcare';
type StepState = 'complete' | 'required' | 'recommended' | 'needs_test' | 'optional';
export interface ReadinessStep { id: string; title: string; description: string; state: StepState; href: string; }

function inferIndustry(department: string, name = ''): WorkspaceIndustry | null {
  const text = `${department} ${name}`.toLowerCase();
  if (text.includes('health') || text.includes('clinic') || text.includes('reception')) return 'healthcare';
  if (text.includes('real estate') || text.includes('property') || department.toLowerCase() === 'sales') return 'real_estate';
  if (text.includes('ecommerce') || text.includes('e-commerce') || department.toLowerCase() === 'operations') return 'ecommerce';
  return null;
}

export async function getWorkspaceReadiness(tenantId: string, targetIndustry?: WorkspaceIndustry) {
  const [agents, storedProfile, shopify, woocommerce, whatsapp, calendarRow, doctors, viewingAgents, services, properties] = await Promise.all([
    prisma.agent.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, department: true, isActive: true } }),
    prisma.businessProfile.findUnique({ where: { tenantId }, select: { profile: true, updatedAt: true } }),
    IntegrationService.getCredential(tenantId, 'shopify').catch(() => null),
    IntegrationService.getCredential(tenantId, 'woocommerce').catch(() => null),
    IntegrationService.getCredential(tenantId, 'whatsapp').catch(() => null),
    prisma.googleCalendarConnection.findUnique({ where: { tenantId }, select: { calendarId: true } }),
    prisma.bookingResource.count({ where: { tenantId, kind: 'healthcare', active: true } }),
    prisma.bookingResource.count({ where: { tenantId, kind: 'real_estate', active: true } }),
    prisma.clinicService.count({ where: { tenantId, active: true } }),
    prisma.propertyListing.count({ where: { tenantId, active: true } }),
  ]);
  const inferred = targetIndustry || (storedProfile ? businessProfileSchema.safeParse(storedProfile.profile).data?.industry : undefined) ||
    inferIndustry(agents[0]?.department || '', agents[0]?.name) || null;
  const profileParse = storedProfile ? businessProfileSchema.safeParse(storedProfile.profile) : null;
  const profileMatches = !!profileParse?.success && (!inferred || profileParse.data.industry === inferred);
  const industry = inferred || (profileParse?.success ? profileParse.data.industry : null);
  const setupHref = `/dashboard/settings/business?onboarding=1${industry ? `&industry=${industry}` : ''}`;
  const steps: ReadinessStep[] = [
    { id: 'bundle', title: 'Choose a business bundle', description: agents.length ? `${agents.length} workforce bundle${agents.length === 1 ? '' : 's'} in this workspace.` : 'Choose the workflow you want AI Workforce to handle.', state: agents.length ? 'complete' : 'required', href: '/dashboard/onboarding' },
    { id: 'profile', title: 'Save your business details', description: profileMatches ? 'Business type, market and working hours are saved.' : storedProfile ? `Choose ${industry || 'the selected bundle'} as your business type and save the profile.` : 'Your market and business hours are needed to set up the workflow.', state: profileMatches ? 'complete' : 'required', href: setupHref },
  ];

  let calendarReady = false;
  if (industry === 'healthcare' || industry === 'real_estate') {
    if (calendarRow?.calendarId) {
      try {
        const status = await getCalendarStatus(tenantId);
        calendarReady = status.connected && !!status.selected && status.canBook === true;
      } catch { calendarReady = false; }
    }
    steps.push({ id: 'calendar', title: 'Connect a bookable Google Calendar', description: calendarReady ? 'A writable calendar is connected and selected.' : 'Booking workflows need Google access that can create events and an owned calendar.', state: calendarReady ? 'complete' : 'required', href: setupHref });
  }

  let commerceReady = false;
  if (industry === 'ecommerce') {
    commerceReady = !!shopify || !!woocommerce;
    steps.push({ id: 'store', title: 'Connect your store', description: commerceReady ? `A ${shopify ? 'Shopify' : 'WooCommerce'} connection is saved for this workspace.` : 'Connect Shopify or WooCommerce so inventory answers use your real catalog.', state: commerceReady ? 'complete' : 'required', href: '/dashboard/integrations?onboarding=1' });
  }

  let recordsReady = false;
  if (industry === 'healthcare') {
    recordsReady = doctors > 0 && services > 0;
    steps.push({ id: 'workflow_data', title: 'Add a doctor and a service', description: recordsReady ? `${doctors} active doctor(s) and ${services} active service(s) are configured.` : 'Add at least one active doctor and one service before booking can go live.', state: recordsReady ? 'complete' : 'required', href: '/dashboard/healthcare' });
  } else if (industry === 'real_estate') {
    recordsReady = viewingAgents > 0 && properties > 0;
    steps.push({ id: 'workflow_data', title: 'Add a viewing agent and property', description: recordsReady ? `${viewingAgents} active viewing agent(s) and ${properties} active propert${properties === 1 ? 'y' : 'ies'} are configured.` : 'Add an active viewing agent and property before lead-to-viewing workflows can go live.', state: recordsReady ? 'complete' : 'required', href: '/dashboard/real-estate' });
  } else if (industry) recordsReady = true;

  const whatsappVerified = whatsapp ? await hasRecentWhatsAppDeliveryProof(tenantId) : false;
  steps.push({
    id: 'whatsapp', title: whatsappVerified ? 'WhatsApp delivery test passed' : whatsapp ? 'Finish WhatsApp delivery test' : 'Connect WhatsApp (optional)',
    description: whatsappVerified ? 'A real inbound message and delivered reply were confirmed recently.' : whatsapp ? 'Credentials are connected, but real two-way delivery has not been verified. AI replies stay paused.' : 'Connect WhatsApp if you want customers to reach this bundle there.',
    state: whatsappVerified ? 'complete' : whatsapp ? 'needs_test' : 'optional', href: '/dashboard/settings/whatsapp',
  });

  const readyToActivate = agents.length > 0 && profileMatches &&
    (industry === 'ecommerce' ? commerceReady : industry === 'healthcare' || industry === 'real_estate' ? calendarReady && recordsReady : false);
  const nextRequired = steps.find(step => step.state === 'required');
  const nextStep = !agents.length ? 'choose_bundle' : !profileMatches ? 'business_profile' :
    industry === 'ecommerce' && !commerceReady || (industry === 'healthcare' || industry === 'real_estate') && !calendarReady ? 'integrations' :
    (industry === 'healthcare' || industry === 'real_estate') && !recordsReady ? 'configure_workflow' : 'ready';
  return {
    industry, agents, bundleCount: agents.length, profileSaved: profileMatches,
    readyToActivate, needsOnboarding: !readyToActivate, nextStep,
    nextAction: nextRequired ? { title: nextRequired.title, href: nextRequired.href } : null,
    steps,
  };
}

export function readinessIndustryForAgent(agent: { department: string; name: string }): WorkspaceIndustry | null {
  return inferIndustry(agent.department, agent.name);
}
