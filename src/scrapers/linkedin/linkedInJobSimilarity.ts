import type { StoredScrapedJob } from '#types';
import { MongoClient } from 'mongodb';
import { getCollection } from '#database/database.js';
import calculateCosineSimilarity from '../../embeddings/calculateCosineSimilarity.js';
import { calculateEmbeddingAverage } from '../../embeddings/embeddings.js';

let likedEmbeddingsCache: { embeddings: number[][]; expiry: number } | null =
  null;
const CACHE_TTL_MS = 30_000;

export function resetLikedEmbeddingsCache(): void {
  likedEmbeddingsCache = null;
}

export async function getEmbeddings(
  liked: boolean,
  client: InstanceType<typeof MongoClient>,
): Promise<number[][]> {
  const now = Date.now();
  if (liked && likedEmbeddingsCache && likedEmbeddingsCache.expiry > now) {
    return likedEmbeddingsCache.embeddings;
  }
  const embeddings = (
    await getCollection<StoredScrapedJob>(client, 'jobs')
      .find({ like: liked })
      .toArray()
  ).map((j) => j.embedding);
  if (liked) {
    likedEmbeddingsCache = { embeddings, expiry: now + CACHE_TTL_MS };
  }
  return embeddings;
}

export async function computeAverageLikedJobSimilarity(
  client: InstanceType<typeof MongoClient>,
  embedding: number[],
): Promise<number | undefined> {
  const likedEmbeddings = await getEmbeddings(true, client);
  const firstLiked = likedEmbeddings[0];
  if (!firstLiked) return undefined;

  return calculateCosineSimilarity(
    calculateEmbeddingAverage(likedEmbeddings),
    embedding,
  );
}
