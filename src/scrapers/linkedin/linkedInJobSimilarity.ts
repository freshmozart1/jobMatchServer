import type { StoredScrapedJob } from "#types";
import { MongoClient } from "mongodb";
import { getCollection } from "#database/database.js";
import calculateCosineSimilarity from "../../embeddings/calculateCosineSimilarity.js";
import { calculateEmbeddingAverage } from "../../embeddings/embeddings.js";

let likedEmbeddingsCache: { embeddings: number[][]; expiry: number } | null =
  null;
let dislikedEmbeddingsCache: { embeddings: number[][]; expiry: number } | null =
  null;
const CACHE_TTL_MS = 30_000;

export function resetLikedEmbeddingsCache(): void {
  likedEmbeddingsCache = null;
}

export function resetDislikedEmbeddingsCache(): void {
  dislikedEmbeddingsCache = null;
}

export async function getEmbeddings(
  liked: boolean,
  client: InstanceType<typeof MongoClient>,
): Promise<number[][]> {
  const now = Date.now();
  if (liked && likedEmbeddingsCache && likedEmbeddingsCache.expiry > now) {
    return likedEmbeddingsCache.embeddings;
  }
  if (
    !liked &&
    dislikedEmbeddingsCache &&
    dislikedEmbeddingsCache.expiry > now
  ) {
    return dislikedEmbeddingsCache.embeddings;
  }
  const embeddings = (
    await getCollection<StoredScrapedJob>(client, "jobs")
      .find({ like: liked })
      .toArray()
  ).map((j) => j.embedding);
  if (liked) {
    likedEmbeddingsCache = { embeddings, expiry: now + CACHE_TTL_MS };
  } else {
    dislikedEmbeddingsCache = { embeddings, expiry: now + CACHE_TTL_MS };
  }
  return embeddings;
}

export async function computeJobMatch(
  client: InstanceType<typeof MongoClient>,
  embedding: number[],
): Promise<number | undefined> {
  const [likedEmbeddings, dislikedEmbeddings] = await Promise.all([
    getEmbeddings(true, client),
    getEmbeddings(false, client),
  ]);
  if (!likedEmbeddings[0]) return undefined;
  const positiveSimilarity = calculateCosineSimilarity(
    calculateEmbeddingAverage(likedEmbeddings),
    embedding,
  );
  if (!dislikedEmbeddings[0]) return positiveSimilarity;
  const negativeSimilarity = calculateCosineSimilarity(
    calculateEmbeddingAverage(dislikedEmbeddings),
    embedding,
  );
  return negativeSimilarity > positiveSimilarity
    ? 1 - negativeSimilarity
    : positiveSimilarity;
}
