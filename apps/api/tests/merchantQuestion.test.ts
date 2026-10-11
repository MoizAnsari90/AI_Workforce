import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ direct: vi.fn(), generate: vi.fn(), format: vi.fn(), model: vi.fn() }));
vi.mock('../src/services/workforceCommerceService', () => ({ answerWorkforceCommerceQuestion: mocks.direct }));
vi.mock('../src/services/storeReportService', () => ({ generateStoreReport: mocks.generate, formatStoreReport: mocks.format }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: mocks.model }; } }));
vi.mock('../src/config/env', () => ({ env: { GEMINI_API_KEY: 'fixture', GEMINI_MODEL: 'fixture' } }));
import { answerMerchantQuestion } from '../src/services/merchantQuestionService';
beforeEach(() => { vi.resetAllMocks(); mocks.direct.mockResolvedValue({ status: 'needs_product', answer: 'Give a product' }); mocks.generate.mockResolvedValue({ checkedAt: 'fixture' }); mocks.format.mockReturnValue('Verified report'); });
it('checks finance permission before reading reports', async () => {
  expect(await answerMerchantQuestion('a', 'Daily report yesterday', ['operations:read'])).toMatchObject({ status: 'forbidden' }); expect(mocks.generate).not.toHaveBeenCalled();
});
it('uses a deterministic report, not model-generated financial figures', async () => {
  expect(await answerMerchantQuestion('a', 'Top products this month', ['finance:read'])).toMatchObject({ answer: 'Verified report', source: 'shopify' }); expect(mocks.model).not.toHaveBeenCalled(); expect(mocks.generate).toHaveBeenCalledWith('a', 'Top products this month');
});
it('normalizes natural-language product names through a tenant-scoped tool', async () => {
  mocks.model.mockResolvedValue({ text: JSON.stringify({ intent: 'product', searchText: 'Blue Tee' }) });
  await answerMerchantQuestion('tenant-a', 'Blue Tee product ka price kia hai?', ['operations:read']);
  expect(mocks.direct).toHaveBeenLastCalledWith('tenant-a', 'Product "Blue Tee" stock and price', ['operations:read']);
});
it('rejects an invented product or order identifier', async () => {
  mocks.model.mockResolvedValue({ text: JSON.stringify({ intent: 'product', searchText: 'Invented' }) });
  await answerMerchantQuestion('a', 'Tell me about a product', ['operations:read']); expect(mocks.direct).toHaveBeenCalledTimes(1);
});
it.each(['Product Blue Tee profit', 'Product Blue Tee stock yesterday'])('never strips unsupported semantics from %s', async q => {
  await answerMerchantQuestion('a', q, ['admin:all']); expect(mocks.model).not.toHaveBeenCalled(); expect(mocks.direct).toHaveBeenCalledTimes(1);
});
it('preserves SKU routing without a model call', async () => {
  mocks.direct.mockResolvedValue(null); expect(await answerMerchantQuestion('a', 'SKU A123 stock?', ['operations:read'])).toBeNull(); expect(mocks.model).not.toHaveBeenCalled();
});
it('keeps provider secrets out of report errors', async () => {
  mocks.generate.mockRejectedValue(new Error('secret access token')); const result = await answerMerchantQuestion('a', 'Daily report today', ['admin:all']); expect(result?.answer).not.toContain('secret access token');
});
