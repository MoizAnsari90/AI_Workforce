import crypto from 'node:crypto';
import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { recordAuditLog } from './auditService';
import { ApprovalService } from './approvalService';
import { IdempotencyService } from './idempotencyService';
import { env } from '../config/env';

// Constants for encryption (using AES-256-GCM as per HIPAA/GDPR readiness in bundleworking.md)
// In a real-world scenario, these keys would be managed securely via environment variables or a KMS.
const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey(): Buffer {
    const encodedKey = env.MEDICAL_DATA_ENCRYPTION_KEY;
    if (!encodedKey) throw new Error('MEDICAL_DATA_ENCRYPTION_KEY must be configured before storing medical data');
    return Buffer.from(encodedKey, 'hex');
}

// --- Encryption Helper ---
interface EncryptedData {
    iv: string;
    ciphertext: string;
    authTag: string;
}

function encryptField(text: string): EncryptedData {
    if (!text) {
        return { iv: '', ciphertext: '', authTag: '' };
    }
    const iv = crypto.randomBytes(12); // GCM uses a 12-byte IV
    const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return {
        iv: iv.toString('hex'),
        ciphertext: encrypted,
        authTag: authTag,
    };
}

function decryptField(encryptedData: EncryptedData | null): string | null {
    if (!encryptedData || !encryptedData.iv || !encryptedData.ciphertext || !encryptedData.authTag) {
        return null;
    }
    try {
        const iv = Buffer.from(encryptedData.iv, 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
        decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));

        let decrypted = decipher.update(encryptedData.ciphertext, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        logger.error('Failed to decrypt medical data', { error: (error instanceof Error ? error.message : String(error)) });
        return null; // Or throw an error depending on desired behavior
    }
}

// --- Healthcare Service ---
export class HealthcareService {

    // --- Patient Intake ---
    static async createPatientIntakeRecord(params: {
        tenantId: string;
        patientName: string;
        contactPhone: string;
        email?: string;
        reasonForVisit: string;
        medicalHistory: string; // Plain text medical history
        userId?: string; // User initiating the intake
        agentId?: string; // Agent performing the intake
    }): Promise<any> { // Return type could be more specific
        const { tenantId, patientName, contactPhone, email, reasonForVisit, medicalHistory, userId, agentId } = params;

        const encryptedMedicalHistory = encryptField(medicalHistory);

        const idempotencyKey = await IdempotencyService.generateIdempotencyKey({
            tenantId,
            actionType: 'create_patient_intake',
            targetResource: 'patient_intake',
            // Include relevant data hash to ensure uniqueness of request content
            requestData: JSON.stringify({ ...params, medicalHistory: '' }), // Exclude sensitive medicalHistory from hash
        });

        const existingLog = await IdempotencyService.checkIdempotency(idempotencyKey.key);
        if (existingLog && existingLog.status === 'succeeded') {
            logger.info('Idempotency check passed for create_patient_intake. Returning existing record.', { idempotencyKey: idempotencyKey.key });
            const existingRecord = await prisma.patientIntakeRecord.findUnique({ where: { id: existingLog.targetResource } }); // Assuming targetResource stores the created record ID
            return { record: existingRecord, decryptedMedicalHistory: decryptField(existingRecord?.encryptionMetadata as any) };
        }

        try {
            const newRecord = await prisma.patientIntakeRecord.create({
                data: {
                    tenantId,
                    patientName,
                    contactPhone,
                    email: email || null,
                    reasonForVisit,
                    encryptedMedicalHistory: encryptedMedicalHistory.ciphertext,
                    encryptionMetadata: {
                        iv: encryptedMedicalHistory.iv,
                        authTag: encryptedMedicalHistory.authTag,
                    } as any, // Prisma expects Json, cast is needed
                    status: 'pending', // Initial status
                },
            });

            await IdempotencyService.logSuccess(idempotencyKey.key, newRecord.id);

            await recordAuditLog({
                tenantId,
                actorType: agentId ? 'agent' : userId ? 'user' : 'system',
                actorId: agentId || userId || 'healthcare_service',
                operation: 'create_patient_intake_record',
                entityType: 'patient_intake_record',
                entityId: newRecord.id,
                newValue: {
                    patientName,
                    contactPhone,
                    reasonForVisit,
                    status: newRecord.status,
                    // Do NOT log encrypted data or history directly
                },
            });

            logger.info('Patient intake record created successfully', { recordId: newRecord.id, tenantId, patientName });
            return { record: newRecord, decryptedMedicalHistory: medicalHistory }; // Return decrypted history on successful creation
        } catch (error) {
            logger.error('Failed to create patient intake record', { tenantId, patientName, error: (error instanceof Error ? error.message : String(error)) });
            await IdempotencyService.logFailure(idempotencyKey.key, (error instanceof Error ? error.message : String(error)));
            throw error;
        }
    }

    // --- Guardrails ---
    static async evaluateGuardrails(params: {
        tenantId: string;
        message: string;
        agentId?: string;
        userId?: string;
        confidenceScore?: number;
        // Other context like conversation history might be passed
    }): Promise<{
        action: 'proceed' | 'block_medical' | 'escalate_to_human' | 'route_emergency';
        message: string; // Response to the user
        escalationDetails?: any; // For human review
    }> {
        const { tenantId, message, agentId, userId, confidenceScore } = params;
        const lowerCaseMessage = message.toLowerCase();

        // Emergency detection (CRITICAL GUARDRAIL)
        const emergencyKeywords = ['911', '1122', 'emergency', 'ambulance', 'chest pain', 'difficulty breathing', 'severe bleeding', 'stroke', 'heart attack', 'unconscious', 'seizure'];
        if (emergencyKeywords.some(keyword => lowerCaseMessage.includes(keyword))) {
            return {
                action: 'route_emergency',
                message: 'We detected what might be a medical emergency. Please call emergency services immediately (e.g., 911 or your local emergency number) or seek immediate medical attention. We cannot assist with emergency situations.',
            };
        }

        // Medical diagnosis/advice prohibition
        const medicalDiagnosisKeywords = ['diagnose', 'prescribe', 'treatment', 'medical advice', 'cure', 'symptoms of', 'what is wrong with me', 'should i take'];
        if (medicalDiagnosisKeywords.some(keyword => lowerCaseMessage.includes(keyword))) {
            await recordAuditLog({
                tenantId,
                actorType: agentId ? 'agent' : userId ? 'user' : 'system',
                actorId: agentId || userId || 'healthcare_service',
                operation: 'block_medical_diagnosis_request',
                entityType: 'message',
                entityId: tenantId, // No specific entity ID for a message content
                newValue: { messageContent: message },
            });
            return {
                action: 'block_medical',
                message: 'I am unable to provide medical diagnoses or advice. Please consult with a qualified healthcare professional for any medical concerns.',
            };
        }

        // Low confidence HITL fallback
        const confidenceThreshold = 0.7; // As per Phase 4, Human-in-the-Loop Fallback Logic
        if (confidenceScore !== undefined && confidenceScore < confidenceThreshold) {
            logger.warn('Low confidence score detected, escalating to human', { tenantId, confidenceScore, message });
            // In a real system, this would trigger a task for human review or route to a live agent queue.
            // For now, we'll simulate it by creating an approval request or task.
            const escalationDetails = { reason: 'Low confidence score', confidence: confidenceScore };
            // Option 1: Create an Approval Request
            // await ApprovalService.createApprovalRequest({
            //     tenantId,
            //     requestedByAgentId: agentId,
            //     actionType: 'human_review_message',
            //     actionPayload: { message, escalationDetails },
            //     associatedTaskId: null, // Could create a Task here instead
            // });
            // Option 2: Log as a task for manual review (simpler for now)
             await recordAuditLog({
                tenantId,
                actorType: agentId ? 'agent' : userId ? 'user' : 'system',
                actorId: agentId || userId || 'healthcare_service',
                operation: 'low_confidence_request_for_review',
                entityType: 'message',
                entityId: tenantId,
                newValue: { messageContent: message, confidence: confidenceScore, escalationDetails },
            });
            return {
                action: 'escalate_to_human',
                message: 'Your request requires human attention. I have forwarded it to our team for review and someone will get back to you shortly.',
                escalationDetails,
            };
        }

        // If none of the above, proceed
        return {
            action: 'proceed',
            message: '', // No special message needed if proceeding
        };
    }

    // --- Appointment Management ---

    // Function to book an appointment
    static async bookAppointment(params: {
        tenantId: string;
        patientIntakeRecordId: string;
        appointmentSlotId: string;
        doctorId: string; // Assuming doctor is associated with a slot
        patientId?: string; // Optional patient ID if available from external system
        patientName?: string;
        agentId?: string; // Agent performing the booking
        userId?: string; // User performing the booking
    }): Promise<any> { // Return type could be more specific
        const { tenantId, patientIntakeRecordId, appointmentSlotId, doctorId, patientId, agentId, userId } = params;

        const idempotencyKey = await IdempotencyService.generateIdempotencyKey({
            tenantId,
            actionType: 'book_appointment',
            targetResource: appointmentSlotId, // Target the slot being booked
            requestData: JSON.stringify({ patientIntakeRecordId, doctorId, patientId }),
        });

        const existingLog = await IdempotencyService.checkIdempotency(idempotencyKey.key);
        if (existingLog && existingLog.status === 'succeeded') {
            logger.info('Idempotency check passed for book_appointment. Returning existing booking.', { idempotencyKey: idempotencyKey.key });
            const bookedSlot = await prisma.appointmentSlot.findUnique({ where: { id: appointmentSlotId }, include: { tenant: true } });
            if (bookedSlot && bookedSlot.status === 'booked') {
                const patientIntake = await prisma.patientIntakeRecord.findUnique({ where: { id: patientIntakeRecordId } });
                return { bookedSlot, patientIntakeRecord: patientIntake, message: 'Appointment already booked.' };
            } else if (bookedSlot && bookedSlot.status === 'locked') {
                // If slot was locked but booking failed previously, attempt to re-book if still valid
                // This logic might need refinement based on retry policies
                logger.warn('Slot was locked but not booked. Attempting to re-book.', { appointmentSlotId, idempotencyKey: idempotencyKey.key });
            } else {
                 throw new Error('Idempotency log indicates success but slot is not in booked state. Manual intervention may be required.');
            }
        }

        // Begin transaction to ensure atomicity
        const transactionResult = await prisma.$transaction(async (tx) => {
            // 1. Find and lock the appointment slot
            const lockedSlot = await tx.appointmentSlot.findUnique({
                where: { id: appointmentSlotId },
            });

            if (!lockedSlot) {
                throw new Error('Appointment slot not found.');
            }
            if (lockedSlot.status !== 'available' && lockedSlot.status !== 'locked') {
                throw new Error(`Appointment slot is already ${lockedSlot.status}.`);
            }

            // If already locked by this idempotency key (e.g., previous attempt timed out)
            if (lockedSlot.status === 'locked' && lockedSlot.idempotencyKey === idempotencyKey.key) {
                logger.info('Slot already locked by this idempotency key. Proceeding to booking.');
            } else if (lockedSlot.status === 'locked' && lockedSlot.idempotencyKey !== idempotencyKey.key) {
                throw new Error('Appointment slot is temporarily locked by another request.');
            }

            const updatedSlot = await tx.appointmentSlot.update({
                where: { id: appointmentSlotId },
                data: {
                    status: 'locked',
                    idempotencyKey: idempotencyKey.key, // Associate idempotency key with the lock
                    patientId: patientId || null,
                    patientName: params.patientName || lockedSlot.patientName, // Update patient info if provided
                },
            });

            // 2. Update the patient intake record status
            await tx.patientIntakeRecord.update({
                where: { id: patientIntakeRecordId },
                data: {
                    status: 'scheduled', // Transition to scheduled
                    // Optionally link to the booked slot if schema allows
                },
            });

            // 3. Book the appointment (essentially, finalize the lock)
            const bookedAppointment = await tx.appointmentSlot.update({
                where: { id: appointmentSlotId },
                data: {
                    status: 'booked',
                    patientId: patientId || updatedSlot.patientId, // Ensure patient details are on the slot too
                    patientName: params.patientName || updatedSlot.patientName,
                    // Remove idempotencyKey from slot itself after successful booking, or keep for reference?
                    // Keeping it might be useful for auditing, but might also complicate re-locking logic.
                    // For now, let's keep it as it's associated with the locked state.
                },
            });

            return { bookedAppointment, patientIntakeRecordId };
        });

        await IdempotencyService.logSuccess(idempotencyKey.key, transactionResult.bookedAppointment.id);

        await recordAuditLog({
            tenantId,
            actorType: agentId ? 'agent' : userId ? 'user' : 'system',
            actorId: agentId || userId || 'healthcare_service',
            operation: 'book_appointment',
            entityType: 'appointment_slot',
            entityId: transactionResult.bookedAppointment.id,
            newValue: {
                patientId: transactionResult.bookedAppointment.patientId,
                patientName: transactionResult.bookedAppointment.patientName,
                startTime: transactionResult.bookedAppointment.startTime,
                endTime: transactionResult.bookedAppointment.endTime,
            },
        });

        logger.info('Appointment booked successfully', { slotId: transactionResult.bookedAppointment.id, tenantId, patientName: transactionResult.bookedAppointment.patientName });
        return transactionResult;
    }

    // Function to lock an appointment slot temporarily
    static async lockAppointmentSlot(params: {
        tenantId: string;
        appointmentSlotId: string;
        patientIntakeRecordId: string; // To link the lock to a patient context
        patientId?: string;
        patientName?: string;
        agentId?: string; // Agent performing the lock
        userId?: string; // User performing the lock
    }): Promise<any> { // Return type could be more specific
        const { tenantId, appointmentSlotId, patientIntakeRecordId, patientId, patientName, agentId, userId } = params;

        const idempotencyKey = await IdempotencyService.generateIdempotencyKey({
            tenantId,
            actionType: 'lock_appointment_slot',
            targetResource: appointmentSlotId,
            requestData: JSON.stringify({ patientIntakeRecordId, patientId, patientName }),
        });

        const existingLog = await IdempotencyService.checkIdempotency(idempotencyKey.key);
        if (existingLog && existingLog.status === 'succeeded') {
            logger.info('Idempotency check passed for lock_appointment_slot. Returning existing locked slot.', { idempotencyKey: idempotencyKey.key });
            const lockedSlot = await prisma.appointmentSlot.findUnique({ where: { id: appointmentSlotId } });
             if (lockedSlot && lockedSlot.status === 'locked' && lockedSlot.idempotencyKey === idempotencyKey.key) {
                 return { slot: lockedSlot, message: 'Slot is already locked by this request.' };
             } else if (lockedSlot && lockedSlot.status === 'booked') {
                 throw new Error('Appointment slot is already booked.');
             } else if (lockedSlot && lockedSlot.status !== 'locked') {
                 // If locked by another request or failed before, and not booked
                 throw new Error(`Appointment slot is already ${lockedSlot.status}.`);
             }
        }

        try {
            const updatedSlot = await prisma.appointmentSlot.update({
                where: { id: appointmentSlotId },
                data: {
                    status: 'locked',
                    idempotencyKey: idempotencyKey.key, // Store idempotency key on the slot for this lock
                    patientId: patientId || null,
                    patientName: patientName || null,
                },
            });

            // Optionally update patient intake status to indicate slot is being locked/processed
            await prisma.patientIntakeRecord.update({
                where: { id: patientIntakeRecordId },
                data: {
                    status: 'processing_appointment',
                },
            });

            await IdempotencyService.logSuccess(idempotencyKey.key, updatedSlot.id);

            await recordAuditLog({
                tenantId,
                actorType: agentId ? 'agent' : userId ? 'user' : 'system',
                actorId: agentId || userId || 'healthcare_service',
                operation: 'lock_appointment_slot',
                entityType: 'appointment_slot',
                entityId: updatedSlot.id,
                newValue: {
                    patientId: updatedSlot.patientId,
                    patientName: updatedSlot.patientName,
                    status: updatedSlot.status,
                    idempotencyKey: idempotencyKey.key,
                },
            });

            logger.info('Appointment slot locked successfully', { slotId: updatedSlot.id, tenantId, patientName: updatedSlot.patientName });
            return { slot: updatedSlot };
        } catch (error) {
            logger.error('Failed to lock appointment slot', { tenantId, appointmentSlotId, error: (error instanceof Error ? error.message : String(error)) });
            await IdempotencyService.logFailure(idempotencyKey.key, (error instanceof Error ? error.message : String(error)));
            // Attempt to revert status if possible and not already booked
            try {
                const slot = await prisma.appointmentSlot.findUnique({ where: { id: appointmentSlotId } });
                if (slot && slot.status === 'locked' && slot.idempotencyKey === idempotencyKey.key) {
                    await prisma.appointmentSlot.update({
                        where: { id: appointmentSlotId },
                        data: { status: 'available', idempotencyKey: null }, // Reset to available
                    });
                }
            } catch (revertError) {
                logger.error('Failed to revert slot status after lock failure', { appointmentSlotId, revertError: (revertError instanceof Error ? revertError.message : String(revertError)) });
            }
            throw error;
        }
    }

    // Function to send appointment reminders (Placeholder for now)
    // This would typically involve a background job system or a queue.
    static async sendAppointmentReminder(params: {
        tenantId: string;
        appointmentSlotId: string;
        patientIntakeRecordId: string; // To fetch patient details
    }): Promise<void> {
        const { tenantId, appointmentSlotId, patientIntakeRecordId } = params;

        logger.info('Scheduling/Sending appointment reminder', { tenantId, appointmentSlotId });

        try {
            const slot = await prisma.appointmentSlot.findUnique({
                where: { id: appointmentSlotId },
                include: {
                    tenant: true, // To potentially get tenant specific notification settings
                }
            });

            if (!slot) {
                logger.warn('Appointment slot not found for reminder', { tenantId, appointmentSlotId });
                return;
            }

            const patientIntake = await prisma.patientIntakeRecord.findUnique({
                where: { id: patientIntakeRecordId },
            });

            if (!patientIntake) {
                logger.warn('Patient intake record not found for reminder', { tenantId, appointmentSlotId, patientIntakeRecordId });
                return;
            }

            // Check if reminder is still relevant (e.g., appointment not cancelled)
            if (slot.status === 'booked' && slot.startTime) {
                const appointmentTime = new Date(slot.startTime);
                const now = new Date();
                const timeDiff = appointmentTime.getTime() - now.getTime();
                const twentyFourHoursInMillis = 24 * 60 * 60 * 1000;

                // Simple check if reminder is for an upcoming appointment (this check would ideally be done by the scheduler)
                if (timeDiff < twentyFourHoursInMillis && timeDiff > 0) {
                    // Construct reminder message
                    // IMPORTANT: Do NOT include sensitive medical details in reminders as per bundleworking.md
                    const reminderMessage = `Hello ${patientIntake.patientName}, this is a reminder for your appointment with ${slot.doctorName || 'our clinic'} on ${appointmentTime.toLocaleString()}. Please confirm by replying or calling us.`;

                    // Logic to send via WhatsApp, Voice, or other channels
                    // Example: using a notification service
                    // await NotificationService.sendWhatsApp({
                    //     to: patientIntake.contactPhone,
                    //     message: reminderMessage,
                    // });
                    // await NotificationService.sendVoiceCall({
                    //     to: patientIntake.contactPhone,
                    //     message: reminderMessage,
                    // });

                    logger.info('Appointment reminder drafted', { tenantId, appointmentSlotId, patientName: patientIntake.patientName, phone: patientIntake.contactPhone });

                    // Record audit log for reminder attempt
                    await recordAuditLog({
                        tenantId,
                        actorType: 'system',
                        actorId: 'healthcare_service',
                        operation: 'send_appointment_reminder',
                        entityType: 'appointment_slot',
                        entityId: appointmentSlotId,
                        newValue: { patientName: patientIntake.patientName, sentTo: patientIntake.contactPhone, status: 'drafted' },
                    });
                } else {
                    logger.warn('Appointment time is not within 24 hours or has passed, skipping reminder.', { tenantId, appointmentSlotId, startTime: slot.startTime });
                }
            } else {
                logger.warn('Appointment slot not in booked status or missing time, skipping reminder.', { tenantId, appointmentSlotId, status: slot.status });
            }
        } catch (error) {
            logger.error('Failed to prepare or send appointment reminder', { tenantId, appointmentSlotId, error: (error instanceof Error ? error.message : String(error)) });
            // Log failure without throwing to avoid blocking other processes if this is backgrounded
            await recordAuditLog({
                tenantId,
                actorType: 'system',
                actorId: 'healthcare_service',
                operation: 'send_appointment_reminder_failed',
                entityType: 'appointment_slot',
                entityId: appointmentSlotId,
                newValue: { error: (error instanceof Error ? error.message : String(error)) },
            });
        }
    }

    // Placeholder for updating patient intake status (e.g., after a call)
    static async updatePatientIntakeStatus(params: {
        tenantId: string;
        patientIntakeRecordId: string;
        newStatus: string; // e.g., 'intake_completed', 'escalated'
        userId?: string;
        agentId?: string;
    }): Promise<any> {
         const { tenantId, patientIntakeRecordId, newStatus, userId, agentId } = params;

         try {
            const updatedIntake = await prisma.patientIntakeRecord.update({
                where: { id: patientIntakeRecordId },
                data: { status: newStatus },
            });

            await recordAuditLog({
                tenantId,
                actorType: agentId ? 'agent' : userId ? 'user' : 'system',
                actorId: agentId || userId || 'healthcare_service',
                operation: 'update_patient_intake_status',
                entityType: 'patient_intake_record',
                entityId: patientIntakeRecordId,
                oldValue: { status: 'pending' }, // Assuming 'pending' or previous status
                newValue: { status: newStatus },
            });

            logger.info('Patient intake status updated', { patientIntakeRecordId, tenantId, newStatus });
            return updatedIntake;
         } catch (error) {
             logger.error('Failed to update patient intake status', { tenantId, patientIntakeRecordId, newStatus, error: (error instanceof Error ? error.message : String(error)) });
             throw error;
         }
    }
}
