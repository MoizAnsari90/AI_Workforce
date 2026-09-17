import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';

export interface RetrievedChunk {
  id: string;
  sourceName?: string;
  content: string;
  score: number;
}

export const ragService = {
  /**
   * Ingest a document/text source and chunk it into the database
   */
  async ingestKnowledgeSource(
    tenantId: string,
    sourceName: string,
    sourceType: 'pdf' | 'txt' | 'url',
    rawContent: string,
    chunkSize = 500
  ) {
    const source = await prisma.knowledgeSource.create({
      data: {
        tenantId,
        sourceName,
        sourceType,
        status: 'processed',
      },
    });

    // Split content into chunks
    const chunks: string[] = [];
    let start = 0;
    while (start < rawContent.length) {
      chunks.push(rawContent.substring(start, start + chunkSize));
      start += chunkSize;
    }

    if (chunks.length > 0) {
      await prisma.documentChunk.createMany({
        data: chunks.map((content) => ({
          tenantId,
          sourceId: source.id,
          content,
        })),
      });
    }

    logger.info('Knowledge source ingested and chunked', {
      tenantId,
      sourceId: source.id,
      chunkCount: chunks.length,
    });

    return { source, chunkCount: chunks.length };
  },

  /**
   * Retrieve relevant document chunks for tenant
   * Strict tenant isolation enforced at query level
   */
  async retrieveChunks(tenantId: string, query: string, limit = 3): Promise<RetrievedChunk[]> {
    const chunks = await prisma.documentChunk.findMany({
      where: { tenantId },
      include: { source: true },
      take: 50,
    });

    if (chunks.length === 0) {
      return [];
    }

    const queryTokens = new Set(
      query
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter((t) => t.length > 2)
    );

    const scoredChunks: RetrievedChunk[] = chunks.map((chunk) => {
      const contentLower = chunk.content.toLowerCase();
      let matchCount = 0;
      queryTokens.forEach((token) => {
        if (contentLower.includes(token)) {
          matchCount++;
        }
      });

      const score = queryTokens.size > 0 ? matchCount / queryTokens.size : 0;
      return {
        id: chunk.id,
        sourceName: chunk.source?.sourceName,
        content: chunk.content,
        score,
      };
    });

    const relevant = scoredChunks
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    logger.info('RAG chunks retrieved for tenant query', {
      tenantId,
      query,
      resultsFound: relevant.length,
    });

    return relevant;
  },
};
