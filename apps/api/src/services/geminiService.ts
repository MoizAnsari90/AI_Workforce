import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env';

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
    model: 'gemini-1.5-flash',
    contents: userQuery,
    config: {
      systemInstruction: systemInstruction,
      temperature: 0.1, // Low temperature for factual precision
    },
  });
  
  return response.text || '';
}
