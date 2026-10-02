import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env';
import { ServiceUnavailableError } from '../errors/AppError';

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY || '' });

export async function runSupportAgent(userQuery: string, ragContext: string, businessName: string = "our store") {
  const systemInstruction = `You are the official Customer Support AI Employee for ${businessName}. Your primary goal is to provide accurate, helpful, and polite support based ONLY on the verified business context provided.

### STRICT RULES & GUARDRAILS:
1. **Factual Accuracy**: Use ONLY the information provided in the "BUSINESS CONTEXT". Do NOT invent, assume, or hallucinate policies, refund details, pricing, stock levels, or order statuses.
2. **Confidence Threshold & Escalation**: If the context does not contain the answer or if you are uncertain, politely state that you cannot process the request directly and that a human team member will assist shortly.
3. **Restricted Actions**: You CANNOT issue refunds, modify orders, or offer unauthorized discounts.
4. **Tone & Style**: Professional, concise, empathetic, and clear. Avoid overly wordy intro/outro fluff.

### BUSINESS CONTEXT:
${ragContext}`;

  const response = await ai.models.generateContent({
    model: env.GEMINI_MODEL,
    contents: userQuery,
    config: {
      systemInstruction: systemInstruction,
      temperature: 0.1, // Low temperature for factual precision
    },
  });
  
  return response.text || '';
}

export async function runAgentTask(systemPrompt: string, input: Record<string, unknown>) {
  if (env.NODE_ENV === 'test') return JSON.stringify({ accepted: true, input });
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required to execute an AI workflow node');

  const response = await ai.models.generateContent({
    model: env.GEMINI_MODEL,
    contents: JSON.stringify(input),
    config: {
      systemInstruction: `${systemPrompt}\n\nUse only the provided JSON context. Return a concise, factual result. Do not claim that external actions were performed.`,
      temperature: 0.1,
    },
  });
  if (!response.text?.trim()) throw new Error('Gemini returned an empty workflow result');
  return response.text.trim();
}

export async function runWorkforceAssistant(question: string, workspaceName: string, metrics: Record<string, number | null>) {
  if (!env.GEMINI_API_KEY) throw new ServiceUnavailableError('Configure GEMINI_API_KEY to use the workforce assistant');
  try {
    const response = await ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: JSON.stringify({ question, workspace: workspaceName, verifiedMetrics: metrics }),
      config: {
        httpOptions: { timeout: 15000 },
        systemInstruction: 'Answer the workspace owner using only the verified database metrics in the supplied JSON. If the data does not answer their question, say so clearly. Do not claim to change data or perform actions. Keep the response concise.',
        temperature: 0.1,
      },
    });
    if (!response.text?.trim()) throw new Error('Gemini returned an empty assistant response');
    return response.text.trim();
  } catch {
    throw new ServiceUnavailableError('The AI provider is temporarily unavailable. Please try again. Direct questions about reply counts, tasks, pending approvals and the workspace summary remain available.');
  }
}

export async function embedDocuments(texts: string[], taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY') {
  if (!env.GEMINI_API_KEY || env.NODE_ENV === 'test' || texts.length === 0) return null;
  const response = await ai.models.embedContent({
    model: env.GEMINI_EMBEDDING_MODEL,
    contents: texts,
    config: { taskType, outputDimensionality: 768 },
  });
  const vectors = response.embeddings?.map((item) => item.values);
  if (!vectors || vectors.length !== texts.length || vectors.some((vector) => !vector?.length)) {
    throw new Error('Gemini returned incomplete document embeddings');
  }
  return vectors as number[][];
}
