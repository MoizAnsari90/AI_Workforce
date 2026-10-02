import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { recordAuditLog } from './auditService';

export class TemplateService {
  /**
   * Seeds default pre-configured niche templates if not already seeded.
   */
  static async seedDefaultTemplates() {
    const templates = [
      {
        name: 'E-commerce Operations AI Bundle',
        category: 'ecommerce',
        description: 'Shopify Inventory Sync + WhatsApp Support + Refund Action + Voice Call Back',
        definition: {
          nodes: [
            { id: 'node_1', type: 'trigger', source: 'whatsapp' },
            { id: 'node_2', type: 'agent', agentName: 'Support Agent', role: 'customer_service' },
            { id: 'node_3', type: 'action', tool: 'shopify_refund', requiresApproval: true },
            { id: 'node_4', type: 'voice', provider: 'RETELL', triggerOnEscalation: true },
          ],
          transitions: [
            { from: 'node_1', to: 'node_2' },
            { from: 'node_2', to: 'node_3' },
            { from: 'node_3', to: 'node_4' },
          ],
        },
      },
      {
        name: 'Real Estate Lead Qualification Bundle',
        category: 'real_estate',
        description: 'Form/WhatsApp Lead Capture + Vapi Auto Voice Call + Appointment Booking',
        definition: {
          nodes: [
            { id: 'node_1', type: 'trigger', source: 'crm_webhook' },
            { id: 'node_2', type: 'agent', agentName: 'Sales Qualification Agent', role: 'sales' },
            { id: 'node_3', type: 'voice', provider: 'VAPI', action: 'auto_qualify_call' },
            { id: 'node_4', type: 'action', tool: 'crm_pipeline', stage: 'Booked' },
          ],
          transitions: [
            { from: 'node_1', to: 'node_2' },
            { from: 'node_2', to: 'node_3' },
            { from: 'node_3', to: 'node_4' },
          ],
        },
      },
      {
        name: 'Healthcare & Clinic Patient Receptionist Bundle',
        category: 'HEALTHCARE',
        description: 'Patient Inquiries + Appointment Scheduling + WhatsApp & Voice Confirmation + Doctor Slot Locking',
        definition: {
          nodes: [
            { id: 'node_1', type: 'trigger', source: 'whatsapp_or_web_chat' },
            { id: 'node_2', type: 'agent', agentName: 'Clinic Receptionist Agent', role: 'healthcare_receptionist' },
            { id: 'node_3', type: 'action', tool: 'calendar_booking_and_slot_locking', requiresApproval: false },
            { id: 'node_4', type: 'voice', provider: 'VAPI', action: 'appointment_voice_confirmation' },
          ],
          transitions: [
            { from: 'node_1', to: 'node_2' },
            { from: 'node_2', to: 'node_3' },
            { from: 'node_3', to: 'node_4' },
          ],
          guardrails: {
            medicalDisclaimer: 'CRITICAL GUARDRAIL: Do NOT provide medical diagnosis, prescription advice, or handle medical emergencies. Instruct patients experiencing emergencies to call emergency services immediately.',
          },
        },
      },
    ];

    for (const t of templates) {
      await prisma.workflowTemplate.upsert({
        where: { name: t.name },
        update: {
          description: t.description,
          category: t.category,
          definition: t.definition as any,
        },
        create: {
          name: t.name,
          description: t.description,
          category: t.category,
          definition: t.definition as any,
        },
      });
    }

    logger.info('Default niche workflow templates (including Healthcare) seeded successfully');
  }

  static async listTemplates() {
    return prisma.workflowTemplate.findMany({
      orderBy: { name: 'asc' },
    });
  }

  static async deployTemplate(tenantId: string, templateId: string, userId: string) {
    const template = await prisma.workflowTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      throw new Error('Workflow template not found');
    }

    // Clone template into tenant workflow and agent records
    const workflow = await prisma.workflow.create({
      data: {
        tenantId,
        name: `Deployed: ${template.name}`,
        graphDefinition: template.definition as any,
      },
    });

    const department = template.category === 'HEALTHCARE' ? 'healthcare' : template.category === 'ecommerce' ? 'operations' : 'sales';

    // Create a default agent associated with this template, including healthcare guardrail if applicable
    const agent = await prisma.agent.create({
      data: {
        tenantId,
        name: `${template.name} Worker`,
        department,
      },
    });

    // If healthcare template, create initial agent version with medical guardrail prompt
    if (template.category === 'HEALTHCARE') {
      await prisma.agentVersion.create({
        data: {
          agentId: agent.id,
          systemPrompt: 'You are a professional Clinic Receptionist Agent. Assist patients with appointment scheduling and slot locking. CRITICAL GUARDRAIL: Never provide medical diagnosis or medical advice. Direct emergency patients to call 911.',
          temperature: 0.1,
          toolAllowlist: ['calendar_booking_and_slot_locking'],
        },
      });
    }

    await recordAuditLog({
      tenantId,
      actorType: 'user',
      actorId: userId,
      operation: 'deploy_workflow_template',
      entityType: 'workflow',
      entityId: workflow.id,
      newValue: { templateName: template.name, agentId: agent.id, category: template.category },
    });

    logger.info('Niche workflow template deployed to tenant', { tenantId, templateId, workflowId: workflow.id });

    return {
      success: true,
      workflowId: workflow.id,
      agentId: agent.id,
      templateName: template.name,
    };
  }
}
