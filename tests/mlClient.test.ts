import { describe, it, expect, vi, afterEach } from 'vitest';
import { predictOrigin, predictOriginBatch } from '../src/services/mlClient.js';
import { surfaceFeatures } from './fixtures/surfaceFeatures.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mlClient', () => {
  it('sends batch feature rows in items and validates the batch response', async () => {
    const features = surfaceFeatures;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({
        model_version: 'eslint-surface-hybrid-ensemble-v1',
        threshold: 0.574674670640332,
        predictions: [],
      }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await predictOriginBatch([features]);

    expect(result.ok).toBe(true);
    const requestOptions = fetchMock.mock.calls[0]?.[1];
    const requestBody = JSON.parse(String(requestOptions?.body));
    expect(requestBody.items).toEqual([features]);
    expect(requestBody).not.toHaveProperty('findings');
    if (result.ok) {
      expect(result.data.model_version).toBe('eslint-surface-hybrid-ensemble-v1');
      expect(result.data.predictions).toEqual([]);
    }
  });

  it('validates a successful prediction response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          probabilities: {
            random_forest: 0.5878,
            logistic_regression: 0.6384,
            xgboost: 0.5165,
          },
          ensemble_surface_probability: 0.5633,
          threshold: 0.574674670640332,
          decision: 'surface',
        }),
      }),
    );

    const result = await predictOrigin(surfaceFeatures);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.decision).toBe('surface');
    }
  });

  it(
    'returns a timeout error when the ML service hangs',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((_url, init) => {
          const signal = init?.signal as AbortSignal | undefined;
          return new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          });
        }),
      );

      const result = await predictOriginBatch([]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('TIMEOUT');
      }
    },
    15000,
  );
});
