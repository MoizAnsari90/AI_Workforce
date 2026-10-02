import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { IdempotencyService } from '../services/idempotencyService'; // Assuming IdempotencyService is in the same directory or adjust path
import { Prisma } from '@prisma/client';

// Define a type for tool calls that might need idempotency
// This is a general interface; specific tools might need tailored payload structures.
interface IdempotentToolCall {
    tenantId: string;
    actionType: string; // e.g., 'shopify_refund', 'crm_lead_update'
    targetResource?: string; // Optional: ID of the resource being acted upon
    requestData: any; // The actual data payload for the tool call
    toolExecutor: (params: any) => Promise<any>; // The function that executes the tool
}

export class IdempotencyMiddleware {

    /**
     * Middleware to wrap tool execution calls, ensuring idempotency.
     * @param req Express request object.
     * @param res Express response object.
     * @param next Express next function.
     */
    static async handleIdempotentCall(req: Request, res: Response, next: NextFunction) {
        const tenantId = req.headers['x-tenant-id'] as string; // Assuming tenant ID is passed in headers
        if (!tenantId) {
            return res.status(400).json({ error: 'Tenant ID header is missing' });
        }

        const toolCall = req.body as IdempotentToolCall;
        if (!toolCall || !toolCall.actionType || !toolCall.requestData || !toolCall.toolExecutor) {
            return res.status(400).json({ error: 'Invalid request body for idempotent call' });
        }

        let idempotencyKeyDetails: { key: string } | undefined;
        let claimed = false;
        try {
            idempotencyKeyDetails = await IdempotencyService.generateIdempotencyKey({
                tenantId: tenantId,
                actionType: toolCall.actionType,
                targetResource: toolCall.targetResource || 'generic',
                requestData: JSON.stringify(toolCall.requestData), // Use stringified payload for hashing
            });

            const existingLog = await IdempotencyService.checkIdempotency(idempotencyKeyDetails.key);

            if (existingLog) {
                logger.info('Idempotency check: Found existing log', { key: idempotencyKeyDetails.key, status: existingLog.status });

                if (existingLog.status === 'succeeded') {
                    logger.info('Idempotency check: Request succeeded previously. Returning cached result.', { key: idempotencyKeyDetails.key });
                    // Return the cached result from the log
                    return res.status(200).json({
                        message: 'Request was successful previously.',
                        result: existingLog.responseSnapshot,
                        fromCache: true,
                    });
                } else if (existingLog.status === 'failed') {
                    // Decide on retry strategy: re-throw, or allow retry if logic permits
                    // For now, re-throwing the error to indicate previous failure
                    logger.warn('Idempotency check: Request failed previously. Re-throwing error.', { key: idempotencyKeyDetails.key, errorMessage: existingLog.errorMessage });
                    // Optionally, you might want to allow retries under certain conditions or based on tool configuration
                    return res.status(500).json({ error: 'Previous attempt failed. Cannot re-execute.', details: existingLog.errorMessage });
                } else { // pending or other statuses
                    logger.warn('Idempotency check: Request is pending or in an unknown state. Blocking re-execution.', { key: idempotencyKeyDetails.key, status: existingLog.status });
                    return res.status(425).json({ error: 'Request is already in progress or in an unconfirmed state. Please wait or try again later.' });
                }
            }

            // If no existing log, create a new one and execute the tool
            logger.info('Idempotency check: No existing log found. Creating new entry and proceeding.', { key: idempotencyKeyDetails.key });
            await IdempotencyService.createPendingLog(idempotencyKeyDetails.key, tenantId, toolCall.actionType, toolCall.targetResource || 'generic');

            claimed = true;
            // Execute the actual tool logic
            const toolResult = await toolCall.toolExecutor(toolCall.requestData);

            // Log success after tool execution
            await IdempotencyService.logSuccess(idempotencyKeyDetails.key, toolCall.targetResource || 'generic', toolResult); // Store result snapshot

            logger.info('Idempotency: Tool executed successfully and log updated.', { key: idempotencyKeyDetails.key });
            // Attach tool result to response body for the caller
            res.locals.toolResult = toolResult; // Pass result to the next handler/controller
            next();

        } catch (error: any) {
            logger.error('Idempotency middleware error', { key: idempotencyKeyDetails?.key, error: error.message });
            // If an error occurred during execution, log it as failed
            if (claimed && idempotencyKeyDetails?.key) {
                await IdempotencyService.logFailure(idempotencyKeyDetails.key, error.message);
            }
            // Forward the error to the error handler or return an error response
            next(error); // Pass error to the next error-handling middleware
        }
    }
}

// Placeholder for IdempotencyService methods if they are not in a separate file.
// In a real application, these would be in './idempotencyService.ts'.
// For demonstration purposes, assuming these methods are available and functional.
/*
class IdempotencyService {
    static async generateIdempotencyKey(params: { tenantId: string; actionType: string; targetResource: string; requestData: string }): Promise<{ key: string; idempotencyLog: IdempotencyLog | null }> { ... }
    static async checkIdempotency(key: string): Promise<IdempotencyLog | null> { ... }
    static async logSuccess(key: string, resourceId: string, responseSnapshot?: any): Promise<void> { ... }
    static async logFailure(key: string, errorMessage: string): Promise<void> { ... }
    static async createPendingLog(key: string, tenantId: string, actionType: string, targetResource: string): Promise<void> { ... } // New method to create pending log
}
*/
