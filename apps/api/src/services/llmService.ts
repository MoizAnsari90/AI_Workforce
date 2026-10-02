import { env } from '../config/env';
import { logger } from '../utils/logger';
import { RetrievedChunk } from './ragService';
import { FAQMatchResult } from './faqService';
import { runSupportAgent } from './geminiService';
import { ShopifyTool } from '../tools/shopifyTool';

export interface GenerateResponseParams {
  tenantId: string;
  userMessage: string;
  conversationHistory: Array<{ senderType: string; textContent: string }>;
  faqMatch?: FAQMatchResult | null;
  ragChunks?: RetrievedChunk[];
  systemPrompt?: string;
  brandVoiceGuide?: string;
}

export interface SupportResponseResult {
  responseText: string;
  source: 'faq' | 'rag' | 'llm' | 'fallback' | 'shopify';
  confidence: number;
  shouldEscalate: boolean;
  escalationReason?: string;
}

const RISKY_PATTERNS = [
  /\brefund\b/i,
  /\bchargeback\b/i,
  /\bcancel\s+(my\s+)?order\b/i,
  /\blawsuit\b/i,
  /\bsue\b/i,
  /\bmanager\b/i,
];

export const llmService = {
  async generateSupportResponse(params: GenerateResponseParams): Promise<SupportResponseResult> {
    const { userMessage, faqMatch, ragChunks, systemPrompt, brandVoiceGuide } = params;

    // Shopify stock is live operational data, so never answer it from FAQ/RAG or
    // an LLM. Route explicit stock questions with an identifiable SKU to the
    // tenant-scoped Shopify tool and use only the provider's returned values.
    const isStockQuestion = /\b(stock|inventory|quantity|available|availability|kitna|kitni)\b/i.test(userMessage);
    if (isStockQuestion) {
      const labeledSku = userMessage.match(/\bsku(?:\s+is)?(?:\s*[:#=]\s*|\s+)["']?([a-z0-9][a-z0-9._-]{0,254})/i)?.[1];
      const sku = labeledSku ?? userMessage.match(/\b[a-z0-9]+(?:[-_.][a-z0-9]+)+\b/i)?.[0];
      if (!sku) {
        return {
          responseText: 'Please share the exact product SKU so I can check its live Shopify stock.',
          source: 'fallback',
          confidence: 0.95,
          shouldEscalate: false,
        };
      }

      try {
        const stock = await ShopifyTool.checkStock(params.tenantId, { sku });
        const locationSummary = stock.locations
          .map((location) => `${location.name ?? 'Location'}: ${location.availableQuantity}`)
          .join(', ');
        return {
          responseText: `Live Shopify stock for ${stock.sku}: ${stock.availableQuantity} available${locationSummary ? ` (${locationSummary})` : ''}.`,
          source: 'shopify',
          confidence: 1,
          shouldEscalate: false,
        };
      } catch (error) {
        logger.warn('Live Shopify stock lookup failed for support request', {
          tenantId: params.tenantId,
          error: error instanceof Error ? error.message : 'Unknown Shopify error',
        });
        return {
          responseText: 'I could not retrieve live stock from Shopify just now. Please ask a store specialist to check it.',
          source: 'fallback',
          confidence: 0.2,
          shouldEscalate: true,
          escalationReason: 'Live Shopify stock lookup failed',
        };
      }
    }

    // 1. Safety Check: If user demands refund or legal escalation
    for (const pattern of RISKY_PATTERNS) {
      if (pattern.test(userMessage) && !faqMatch) {
        logger.warn('Customer message triggered escalation policy', {
          userMessage,
          tenantId: params.tenantId,
        });
        return {
          responseText:
            'I understand your request is urgent. I am connecting you with a human support specialist right away to assist you with this directly.',
          source: 'fallback',
          confidence: 0.95,
          shouldEscalate: true,
          escalationReason: 'Customer requested refund or human escalation',
        };
      }
    }

    // 2. High-Confidence FAQ match override
    if (faqMatch && faqMatch.similarityScore >= 0.80) {
      return {
        responseText: faqMatch.answer,
        source: 'faq',
        confidence: faqMatch.similarityScore,
        shouldEscalate: false,
      };
    }

    // 3. RAG-Augmented response
    if (ragChunks && ragChunks.length > 0 && ragChunks[0].score > 0) {
      
      // If Gemini API key is configured, use live LLM completion
      if (env.GEMINI_API_KEY && env.NODE_ENV !== 'test') {
        try {
          const ragContext = ragChunks.map((c) => c.content).join('\n---\n');
          const reply = await runSupportAgent(userMessage, ragContext, 'Customer Support');
          
          if (reply) {
            return {
              responseText: reply,
              source: 'rag',
              confidence: 0.9,
              shouldEscalate: false,
            };
          }
        } catch (err) {
          logger.error('Gemini API call failed, falling back to deterministic synthesis', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Deterministic factual synthesis from knowledge chunks
      const topChunk = ragChunks[0];
      const tonePrefix = brandVoiceGuide ? `[Voice: ${brandVoiceGuide}] ` : '';
      return {
        responseText: `${tonePrefix}${topChunk.content}`,
        source: 'rag',
        confidence: Math.min(topChunk.score + 0.3, 0.92),
        shouldEscalate: false,
      };
    }

    // 4. Low confidence fallback / Escalation
    return {
      responseText:
        'Thank you for reaching out. I want to make sure you get the exact details, so I am transferring your inquiry to our support team.',
      source: 'fallback',
      confidence: 0.4,
      shouldEscalate: true,
      escalationReason: 'No matching FAQ or verified knowledge base documents found',
    };
  },
};
