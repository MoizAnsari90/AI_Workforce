import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';

export interface FAQMatchResult {
  faqId: string;
  question: string;
  answer: string;
  similarityScore: number;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .trim();
}

function calculateSimilarity(strA: string, strB: string): number {
  const normA = normalizeText(strA);
  const normB = normalizeText(strB);

  if (normA === normB) return 1.0;
  if (!normA || !normB) return 0.0;

  // Word token overlap (Jaccard index)
  const tokensA = new Set(normA.split(/\s+/));
  const tokensB = new Set(normB.split(/\s+/));

  const intersection = new Set([...tokensA].filter((t) => tokensB.has(t)));
  const union = new Set([...tokensA, ...tokensB]);

  const jaccard = union.size > 0 ? intersection.size / union.size : 0.0;

  // Substring bonus
  if (normA.includes(normB) || normB.includes(normA)) {
    return Math.max(jaccard, 0.85);
  }

  return jaccard;
}

export const faqService = {
  /**
   * Find matching FAQ for a given tenant and query text
   * Threshold: >= 0.80
   */
  async matchFAQ(tenantId: string, queryText: string, threshold = 0.80): Promise<FAQMatchResult | null> {
    const activeFaqs = await prisma.fAQ.findMany({
      where: {
        tenantId,
        isActive: true,
      },
    });

    if (activeFaqs.length === 0) {
      return null;
    }

    let bestMatch: FAQMatchResult | null = null;
    let highestScore = 0;

    for (const faq of activeFaqs) {
      const score = calculateSimilarity(queryText, faq.question);
      if (score > highestScore && score >= threshold) {
        highestScore = score;
        bestMatch = {
          faqId: faq.id,
          question: faq.question,
          answer: faq.answer,
          similarityScore: score,
        };
      }
    }

    if (bestMatch) {
      logger.info('FAQ match found for inquiry', {
        tenantId,
        queryText,
        matchedQuestion: bestMatch.question,
        score: bestMatch.similarityScore,
      });
    }

    return bestMatch;
  },
};
