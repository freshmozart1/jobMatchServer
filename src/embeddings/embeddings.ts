import type { TextEmbedding } from '#types';
import { OpenAI } from 'openai';

const EMBEDDING_MODEL = 'text-embedding-3-small';

export async function embed(input: string): Promise<TextEmbedding> {
  const client = new OpenAI();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: [input],
  });
  const embedding = response.data[0]?.embedding;

  if (response.data.length !== 1 || !embedding) {
    throw new Error('OpenAI did not return an embedding');
  }

  return embedding;
}
export function calculateEmbeddingAverage(embeddings: number[][]): number[] {
  if (embeddings.length === 0 || !embeddings[0]) return [];
  const sum = new Array<number>(embeddings[0].length).fill(0);
  for (const embedding of embeddings) {
    for (let i = 0; i < sum.length; i++) {
      const s = sum[i],
        e = embedding[i];
      if (typeof s === 'number' && typeof e === 'number') sum[i] = s + e;
    }
  }
  return sum.map((e) => e / embeddings.length);
}
