import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const createEmbedding = jest.fn<
  (request: { model: string; input: string[] }) => Promise<{
    data: Array<{ embedding?: number[] }>;
  }>
>();

jest.unstable_mockModule('openai', () => ({
  OpenAI: class {
    embeddings = { create: createEmbedding };
  },
}));

const { embed } = await import('./embeddings.js');

describe('embed', () => {
  beforeEach(() => {
    createEmbedding.mockReset();
  });

  it('requests one embedding and returns its exact vector', async () => {
    const embedding = [0.25, -0.5];
    createEmbedding.mockResolvedValue({ data: [{ embedding }] });

    await expect(embed('Synthetic job')).resolves.toBe(embedding);
    expect(createEmbedding).toHaveBeenCalledTimes(1);
    expect(createEmbedding).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: ['Synthetic job'],
    });
  });

  it.each([
    { data: [] },
    { data: [{ embedding: [0.25] }, { embedding: [-0.5] }] },
    { data: [{}] },
  ])('rejects absent, extra or missing embeddings: %j', async (response) => {
    createEmbedding.mockResolvedValue(response);

    await expect(embed('Synthetic job')).rejects.toThrow(
      'OpenAI did not return an embedding',
    );
  });

  it('preserves provider rejection', async () => {
    const error = new Error('Synthetic provider failure');
    createEmbedding.mockRejectedValue(error);

    await expect(embed('Synthetic job')).rejects.toBe(error);
  });
});
