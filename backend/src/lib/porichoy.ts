import type { Config } from '../config/index.js';
import type { Logger } from '../lib/logger.js';

export interface PorichoySubmitInput {
  txnId: string;
  nidFrontUrl: string;
  nidBackUrl: string;
  selfieUrl?: string;
  livenessId?: string;
}

export interface PorichoyClient {
  submit(input: PorichoySubmitInput): Promise<unknown>;
}

/**
 * Porichoy e-KYC (Election Commission data). Returns `null` when credentials
 * are absent — the service then parks the submission in `pending-vendor`
 * instead of pretending verification happened.
 */
export function createPorichoyClient(config: Config, logger: Logger): PorichoyClient | null {
  if (!config.PORICHOY_BASE_URL || !config.PORICHOY_API_KEY) return null;

  const baseUrl = config.PORICHOY_BASE_URL.replace(/\/$/, '');
  return {
    async submit(input) {
      const response = await fetch(`${baseUrl}/v1/verify`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': config.PORICHOY_API_KEY as string,
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(8_000),
      });

      if (!response.ok) {
        logger.warn({ status: response.status, txnId: input.txnId }, 'porichoy submit failed');
        throw new Error(`porichoy_http_${response.status}`);
      }
      return response.json();
    },
  };
}
