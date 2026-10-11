import { prisma } from '../lib/prisma';

// A bundle worker is represented by its department, not a hard-coded display name.
export async function hasActiveChannelAgent(tenantId: string, channel: 'support' | 'healthcare' | 'real_estate') {
  const departments = channel === 'support' ? ['support', 'operations'] : channel === 'healthcare' ? ['healthcare'] : ['sales'];
  return !!await prisma.agent.findFirst({ where: { tenantId, isActive: true, department: { in: departments } }, select: { id: true } });
}
