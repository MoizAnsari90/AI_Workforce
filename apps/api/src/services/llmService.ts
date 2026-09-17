import { env } from '../config/env';
import { logger } from '../utils/logger';
import { RetrievedChunk } from './ragService';
import { FAQMatchResult } from './faqService';
import { runSupportAgent } from './geminiService';

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
  source: 'faq' | 'rag' | 'llm' | 'fallback';
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
      if (env.GEMINI_API_KEY && env.NODE_ENV === 'production') {
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
