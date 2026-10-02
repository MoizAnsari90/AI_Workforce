import { vi, describe, it, expect, beforeEach } from 'vitest';
import { HealthcareService } from '../src/services/healthcareService';
import { ApprovalService } from '../src/services/approvalService';
import { IdempotencyService } from '../src/services/idempotencyService'; // Assuming this is accessible for mocking
import { recordAuditLog } from '../src/services/auditService';
import { prisma } from '../src/lib/prisma';

// Mock dependencies
vi.mock('../src/lib/prisma', () => ({ prisma: {} }));
vi.mock('../src/services/auditService', () => ({ recordAuditLog: vi.fn() }));
vi.mock('../src/services/approvalService', () => ({ ApprovalService: { createApprovalRequest: vi.fn() } }));
vi.mock('../src/services/idempotencyService', () => ({
    IdempotencyService: {
        generateIdempotencyKey: vi.fn(),
        checkIdempotency: vi.fn(),
        logSuccess: vi.fn(),
        logFailure: vi.fn(),
        createPendingLog: vi.fn(), // Mock this if it's used in healthcareService directly
    }
}));

// Mock crypto for encryption/decryption helpers if they are internal to HealthcareService and not imported
// For now, assuming they are within HealthcareService and we test the public interface.

describe('HealthcareService Guardrails', () => {
    const tenantId = 'test-tenant-123';
    const agentId = 'test-agent-abc';

    beforeEach(() => {
        // Reset mocks before each test
        vi.clearAllMocks();
        // Mocking specific IdempotencyService methods that might be called
        IdempotencyService.generateIdempotencyKey.mockResolvedValue({ key: 'mock-key', idempotencyLog: null });
        IdempotencyService.checkIdempotency.mockResolvedValue(null);
        IdempotencyService.logSuccess.mockResolvedValue(undefined);
        IdempotencyService.logFailure.mockResolvedValue(undefined);
        IdempotencyService.createPendingLog.mockResolvedValue(undefined);
        recordAuditLog.mockResolvedValue(undefined);
        ApprovalService.createApprovalRequest.mockResolvedValue({ id: 'mock-approval-id' });
    });

    // Test cases for Emergency Detection
    describe('Emergency Detection', () => {
        it('should route critical emergency messages immediately', async () => {
            const message = 'I am having severe chest pain and difficulty breathing, call 911!';
            const result = await HealthcareService.evaluateGuardrails({ tenantId, message, agentId });

            expect(result.action).toBe('route_emergency');
            expect(result.message).toContain('call emergency services immediately');
            expect(recordAuditLog).not.toHaveBeenCalled(); // Audit log might not be called for direct routing before action
        });

        it('should detect other emergency keywords', async () => {
            const message = 'My child had a stroke, what should I do?';
            const result = await HealthcareService.evaluateGuardrails({ tenantId, message, agentId });

            expect(result.action).toBe('route_emergency');
            expect(result.message).toContain('call emergency services immediately');
        });
    });

    // Test cases for Medical Diagnosis Prohibition
    describe('Medical Diagnosis Prohibition', () => {
        it('should block requests for medical diagnosis', async () => {
            const message = 'What are the symptoms of the flu?';
            const result = await HealthcareService.evaluateGuardrails({ tenantId, message, agentId });

            expect(result.action).toBe('block_medical');
            expect(result.message).toContain('unable to provide medical diagnoses or advice');
            expect(recordAuditLog).toHaveBeenCalledWith(expect.objectContaining({
                operation: 'block_medical_diagnosis_request',
                entityType: 'message',
                newValue: { messageContent: message },
            }));
        });

        it('should block requests for treatment advice', async () => {
            const message = 'Should I take antibiotics for this cough?';
            const result = await HealthcareService.evaluateGuardrails({ tenantId, message, agentId });

            expect(result.action).toBe('block_medical');
            expect(result.message).toContain('consult with a qualified healthcare professional');
        });
    });

    // Test cases for Low Confidence HITL Fallback
    describe('Low Confidence HITL Fallback', () => {
        it('should escalate to human if confidence score is below threshold', async () => {
            const message = 'I need to book an appointment for a check-up.';
            const confidenceScore = 0.65; // Below threshold
            const result = await HealthcareService.evaluateGuardrails({ tenantId, message, agentId, confidenceScore });

            expect(result.action).toBe('escalate_to_human');
            expect(result.message).toContain('requires human attention');
            expect(result.escalationDetails).toBeDefined();
            expect(result.escalationDetails.reason).toBe('Low confidence score');
            // Check if audit log was called for low confidence event
            expect(recordAuditLog).toHaveBeenCalledWith(expect.objectContaining({
                operation: 'low_confidence_request_for_review',
                newValue: expect.objectContaining({ messageContent: message, confidence: confidenceScore }),
            }));
        });

        it('should proceed if confidence score is above threshold', async () => {
            const message = 'I want to book a physical exam.';
            const confidenceScore = 0.85; // Above threshold
            const result = await HealthcareService.evaluateGuardrails({ tenantId, message, agentId, confidenceScore });

            expect(result.action).toBe('proceed');
            expect(result.message).toBe('');
        });
    });
});
