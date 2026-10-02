import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { embedDocuments } from './geminiService';

export interface RetrievedChunk {
  id: string;
  sourceName?: string;
  content: string;
  score: number;
}

function toVector(value: string | null): number[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'number') ? parsed : null;
  } catch {
    return null;
  }
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return Math.max(0, dot / Math.sqrt(leftMagnitude * rightMagnitude));
}

function lexicalScore(content: string, queryTokens: Set<string>) {
  if (queryTokens.size === 0) return 0;
  const tokens = content.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
  const frequencies = new Map<string, number>();
  for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  let score = 0;
  for (const token of queryTokens) {
    score += Math.min(frequencies.get(token) ?? 0, 3) > 0 ? 1 : 0;
  }
  return score / queryTokens.size;
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

    let embeddings: number[][] | null = null;
    if (chunks.length > 0) {
      try {
        embeddings = await embedDocuments(chunks, 'RETRIEVAL_DOCUMENT');
      } catch (error) {
        logger.warn('Knowledge source embeddings unavailable; lexical retrieval will be used', {
          tenantId,
          sourceId: source.id,
          error: error instanceof Error ? error.message : 'Unknown embedding error',
        });
      }
    }

    if (chunks.length > 0) {
      await prisma.documentChunk.createMany({
        data: chunks.map((content, index) => ({
          tenantId,
          sourceId: source.id,
          content,
          embedding: embeddings ? JSON.stringify(embeddings[index]) : null,
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
      orderBy: { createdAt: 'desc' },
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

    let queryVector: number[] | null = null;
    let vectors = chunks.map((chunk) => toVector(chunk.embedding));
    try {
      const [generatedQueryVector] = await embedDocuments([query], 'RETRIEVAL_QUERY') ?? [];
      queryVector = generatedQueryVector ?? null;
      const missingIndices = vectors.flatMap((vector, index) => vector ? [] : [index]);
      if (queryVector && missingIndices.length > 0) {
        const generated = await embedDocuments(missingIndices.map((index) => chunks[index].content), 'RETRIEVAL_DOCUMENT');
        if (generated) {
          await Promise.all(missingIndices.map((index, generatedIndex) =>
            prisma.documentChunk.updateMany({
              where: { id: chunks[index].id, tenantId, embedding: null },
              data: { embedding: JSON.stringify(generated[generatedIndex]) },
            }),
          ));
          vectors = vectors.map((vector, index) => vector ?? generated[missingIndices.indexOf(index)] ?? null);
        }
      }
    } catch (error) {
      logger.warn('Question embeddings unavailable; lexical retrieval will be used', {
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown embedding error',
      });
    }

    const scoredChunks: RetrievedChunk[] = chunks.map((chunk, index) => {
      const score = queryVector && vectors[index]
        ? cosineSimilarity(queryVector, vectors[index]!)
        : lexicalScore(chunk.content, queryTokens);
      return {
        id: chunk.id,
        sourceName: chunk.source?.sourceName,
        content: chunk.content,
        score,
      };
    });

    const relevant = scoredChunks
      .filter((c) => c.score > (queryVector ? 0.35 : 0))
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
