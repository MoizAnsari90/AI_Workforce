import { vi, describe, it, expect, beforeEach } from 'vitest';
import { IdempotencyMiddleware } from '../src/middleware/idempotencyMiddleware';
import { IdempotencyService } from '../src/services/idempotencyService';
import { prisma } from '../src/lib/prisma';

// Mock dependencies
vi.mock('../src/lib/prisma', () => ({ prisma: {} }));
vi.mock('../src/services/idempotencyService', () => ({
    IdempotencyService: {
        generateIdempotencyKey: vi.fn(),
        checkIdempotency: vi.fn(),
        logSuccess: vi.fn(),
        logFailure: vi.fn(),
        createPendingLog: vi.fn(),
    }
}));

describe('IdempotencyMiddleware', () => {
    const mockRequest = (body: any, headers: Record<string, string> = { 'x-tenant-id': 'test-tenant-456' }) => ({
        body,
        headers,
        locals: {},
    } as any);

    const mockResponse = () => ({
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        locals: {},
    } as any);

    const mockNext = vi.fn();

    const mockToolExecutor = vi.fn();

    const tenantId = 'test-tenant-456';

    beforeEach(() => {
        vi.clearAllMocks();
        mockRequest({}).headers = { 'x-tenant-id': tenantId }; // Default tenant header
        IdempotencyService.generateIdempotencyKey.mockResolvedValue({ key: 'mock-idempotency-key', idempotencyLog: null });
        IdempotencyService.checkIdempotency.mockResolvedValue(null);
        IdempotencyService.logSuccess.mockResolvedValue(undefined);
        IdempotencyService.logFailure.mockResolvedValue(undefined);
        IdempotencyService.createPendingLog.mockResolvedValue(undefined);
    });

    it('should return 400 if Tenant ID header is missing', async () => {
        const req = mockRequest({});
        delete req.headers['x-tenant-id'];
        const res = mockResponse();
        const next = mockNext;

        await IdempotencyMiddleware.handleIdempotentCall(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Tenant ID header is missing' });
        expect(next).not.toHaveBeenCalled();
    });

    it('should return 400 if request body is invalid', async () => {
        const req = mockRequest({}); // Missing actionType, requestData, toolExecutor
        const res = mockResponse();
        const next = mockNext;

        await IdempotencyMiddleware.handleIdempotentCall(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid request body for idempotent call' });
        expect(next).not.toHaveBeenCalled();
    });

    it('should return 200 with cached result if request succeeded previously', async () => {
        const mockResult = { data: 'cached data' };
        IdempotencyService.checkIdempotency.mockResolvedValue({
            id: 'log-id-1',
            tenantId: tenantId,
            idempotencyKey: 'mock-idempotency-key',
            actionType: 'test_action',
            targetResource: 'some_resource',
            requestHash: 'some_hash',
            status: 'succeeded',
            responseSnapshot: JSON.stringify(mockResult), // Assuming snapshot is stringified
            attemptCount: 1,
            errorMessage: null,
            startedAt: new Date(),
            completedAt: new Date(),
        });

        const req = mockRequest({
            actionType: 'test_action',
            requestData: { param1: 'value1' },
            toolExecutor: mockToolExecutor.mockResolvedValue(mockResult),
        });
        const res = mockResponse();
        const next = mockNext;

        await IdempotencyMiddleware.handleIdempotentCall(req, res, next);

        expect(IdempotencyService.checkIdempotency).toHaveBeenCalledWith('mock-idempotency-key');
        expect(IdempotencyService.generateIdempotencyKey).toHaveBeenCalled();
        expect(mockToolExecutor).not.toHaveBeenCalled(); // Tool should not be executed
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            message: 'Request was successful previously.',
            result: '{"data":"cached data"}', // Snapshot is stringified JSON
            fromCache: true,
        });
        expect(next).not.toHaveBeenCalled();
    });

    it('should return 500 if previous attempt failed', async () => {
        IdempotencyService.checkIdempotency.mockResolvedValue({
            id: 'log-id-2',
            tenantId: tenantId,
            idempotencyKey: 'mock-idempotency-key',
            actionType: 'test_action',
            targetResource: 'some_resource',
            requestHash: 'some_hash',
            status: 'failed',
            responseSnapshot: null,
            attemptCount: 1,
            errorMessage: 'Simulated failure',
            startedAt: new Date(),
            completedAt: new Date(),
        });

        const req = mockRequest({
            actionType: 'test_action',
            requestData: { param1: 'value1' },
            toolExecutor: mockToolExecutor.mockResolvedValue({ data: 'success' }),
        });
        const res = mockResponse();
        const next = mockNext;

        await IdempotencyMiddleware.handleIdempotentCall(req, res, next);

        expect(IdempotencyService.checkIdempotency).toHaveBeenCalledWith('mock-idempotency-key');
        expect(mockToolExecutor).not.toHaveBeenCalled(); // Tool should not be executed
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ error: 'Previous attempt failed. Cannot re-execute.', details: 'Simulated failure' });
        expect(next).not.toHaveBeenCalled();
    });

    it('should return 425 if request is pending or in an unknown state', async () => {
        IdempotencyService.checkIdempotency.mockResolvedValue({
            id: 'log-id-3',
            tenantId: tenantId,
            idempotencyKey: 'mock-idempotency-key',
            actionType: 'test_action',
            targetResource: 'some_resource',
            requestHash: 'some_hash',
            status: 'pending', // Or 'processing' etc.
            responseSnapshot: null,
            attemptCount: 1,
            errorMessage: null,
            startedAt: new Date(),
            completedAt: null,
        });

        const req = mockRequest({
            actionType: 'test_action',
            requestData: { param1: 'value1' },
            toolExecutor: mockToolExecutor.mockResolvedValue({ data: 'success' }),
        });
        const res = mockResponse();
        const next = mockNext;

        await IdempotencyMiddleware.handleIdempotentCall(req, res, next);

        expect(IdempotencyService.checkIdempotency).toHaveBeenCalledWith('mock-idempotency-key');
        expect(mockToolExecutor).not.toHaveBeenCalled(); // Tool should not be executed
        expect(res.status).toHaveBeenCalledWith(425);
        expect(res.json).toHaveBeenCalledWith({ error: 'Request is already in progress or in an unconfirmed state. Please wait or try again later.' });
        expect(next).not.toHaveBeenCalled();
    });

    it('should create a new log and execute tool if no previous log exists', async () => {
        const mockToolResult = { success: true, message: 'Operation completed' };
        mockToolExecutor.mockResolvedValue(mockToolResult);

        const req = mockRequest({
            actionType: 'test_action',
            targetResource: 'resource-123',
            requestData: { param1: 'value1', param2: 'value2' },
            toolExecutor: mockToolExecutor,
        });
        const res = mockResponse();
        const next = mockNext;

        await IdempotencyMiddleware.handleIdempotentCall(req, res, next);

        expect(IdempotencyService.generateIdempotencyKey).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: tenantId,
            actionType: 'test_action',
            targetResource: 'resource-123',
            requestData: JSON.stringify({ param1: 'value1', param2: 'value2' }),
        }));
        expect(IdempotencyService.checkIdempotency).toHaveBeenCalledWith('mock-idempotency-key');
        expect(IdempotencyService.createPendingLog).toHaveBeenCalledWith('mock-idempotency-key', tenantId, 'test_action', 'resource-123');
        expect(mockToolExecutor).toHaveBeenCalledWith({ param1: 'value1', param2: 'value2' });
        expect(IdempotencyService.logSuccess).toHaveBeenCalledWith('mock-idempotency-key', 'resource-123', mockToolResult);

        expect(res.locals.toolResult).toEqual(mockToolResult);
        expect(next).toHaveBeenCalled(); // next() is called after successful execution
    });

    it('should log failure and pass error to next if tool execution fails', async () => {
        const executionError = new Error('Tool execution failed');
        mockToolExecutor.mockRejectedValue(executionError);

        const req = mockRequest({
            actionType: 'test_action',
            requestData: { param: 'value' },
            toolExecutor: mockToolExecutor,
        });
        const res = mockResponse();
        const next = mockNext;

        await IdempotencyMiddleware.handleIdempotentCall(req, res, next);

        expect(mockToolExecutor).toHaveBeenCalled();
        expect(IdempotencyService.logFailure).toHaveBeenCalledWith('mock-idempotency-key', 'Tool execution failed');
        expect(next).toHaveBeenCalledWith(executionError); // Error should be passed to next middleware
    });
});
