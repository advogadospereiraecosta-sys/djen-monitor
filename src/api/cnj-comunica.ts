/**
 * DJEN Monitor - Cliente API CNJ Comunica
 * Integracao com a API de comunicacao processual do CNJ
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { loggerApi } from '../lib/logger.js';
import { sleep } from '../lib/utils.js';

// Configuracoes da API
const BASE_URL = process.env.CNJ_COMUNICA_BASE_URL || 'https://comunicaapi.pje.jus.br';
const TIMEOUT = parseInt(process.env.CNJ_COMUNICA_TIMEOUT || '30000', 10);
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

// ===========================================
// Tipos da API CNJ
// ===========================================

export interface CNJPublication {
  id: string;
  numeroProcesso?: string;
  tipo?: string;
  titulo?: string;
  descricao?: string;
  orgaoJulgador?: string;
  dataPublicacao?: string;
  dataDisponibilizacao?: string;
  conteudo?: string;
  documento?: {
    id: string;
    tipo?: string;
    descricao?: string;
  }[];
}

export interface CNJSearchResult {
  total: number;
  publicacoes: CNJPublication[];
}

export interface CNJSearchParams {
  tipoBusca?: 'OAB' | 'CNJ' | 'CPF';
  valor?: string;
  dataInicio?: string;
  dataFim?: string;
  orgao?: string;
}

// ===========================================
// Cache em memoria
// ===========================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class MemoryCache {
  private cache = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  set<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

const cache = new MemoryCache();

// ===========================================
// Cliente HTTP
// ===========================================

class CNJComunicaClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'DJEN-Monitor/1.0',
      },
    });

    // Interceptors
    this.client.interceptors.request.use(
      (config) => {
        loggerApi.debug({ url: config.url, params: config.params }, 'CNJ API request');
        return config;
      },
      (error) => {
        loggerApi.error({ error }, 'CNJ API request error');
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        loggerApi.debug({ status: response.status, url: response.config.url }, 'CNJ API response');
        return response;
      },
      async (error: AxiosError) => {
        loggerApi.error({
          status: error.response?.status,
          message: error.message,
          url: error.config?.url,
        }, 'CNJ API response error');
        return Promise.reject(error);
      }
    );
  }

  /**
   * Executa requisicao com retry e exponential backoff
   */
  private async requestWithRetry<T>(
    fn: () => Promise<T>,
    retries: number = MAX_RETRIES
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        // Nao retry em erros 4xx (exceto 429 - rate limit)
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          if (status && status >= 400 && status < 500 && status !== 429) {
            throw error;
          }
        }

        if (attempt < retries) {
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
          loggerApi.warn({ attempt: attempt + 1, delay }, 'Retrying CNJ API request');
          await sleep(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Busca publicacoes por OAB
   */
  async searchByOAB(
    oab: string,
    uf: string,
    dateFrom?: Date,
    dateTo?: Date
  ): Promise<CNJSearchResult> {
    const cacheKey = `oab:${oab}:${uf}:${dateFrom?.toISOString()}:${dateTo?.toISOString()}`;

    // Verifica cache
    const cached = cache.get<CNJSearchResult>(cacheKey);
    if (cached) {
      loggerApi.debug({ oab, uf }, 'Returning cached CNJ search result');
      return cached;
    }

    const params: Record<string, string> = {
      tipoBusca: 'OAB',
      valor: `${oab}/${uf}`,
    };

    if (dateFrom) {
      params.dataInicio = dateFrom.toISOString().split('T')[0];
    }
    if (dateTo) {
      params.dataFim = dateTo.toISOString().split('T')[0];
    }

    const result = await this.requestWithRetry(async () => {
      const response = await this.client.get<CNJSearchResult>(
        '/api/v1/publicacoes',
        { params }
      );
      return response.data;
    });

    // Armazena no cache
    cache.set(cacheKey, result);

    loggerApi.info({
      oab,
      uf,
      total: result.total,
      publications: result.publicacoes.length,
    }, 'CNJ OAB search completed');

    return result;
  }

  /**
   * Busca publicacao por numero CNJ
   */
  async searchByCNJ(cnjNumber: string): Promise<CNJPublication | null> {
    const cacheKey = `cnj:${cnjNumber}`;

    const cached = cache.get<CNJPublication | null>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const result = await this.requestWithRetry(async () => {
      const response = await this.client.get<CNJPublication>(
        `/api/v1/publicacoes/${cnjNumber}`
      );
      return response.data;
    }).catch((error: unknown) => {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    });

    cache.set(cacheKey, result);

    loggerApi.info({ cnjNumber, found: !!result }, 'CNJ number search completed');

    return result;
  }

  /**
   * Busca publicacoes por CPF
   */
  async searchByCPF(cpf: string, dateFrom?: Date, dateTo?: Date): Promise<CNJSearchResult> {
    const cacheKey = `cpf:${cpf}:${dateFrom?.toISOString()}:${dateTo?.toISOString()}`;

    const cached = cache.get<CNJSearchResult>(cacheKey);
    if (cached) {
      return cached;
    }

    const params: Record<string, string> = {
      tipoBusca: 'CPF',
      valor: cpf,
    };

    if (dateFrom) {
      params.dataInicio = dateFrom.toISOString().split('T')[0];
    }
    if (dateTo) {
      params.dataFim = dateTo.toISOString().split('T')[0];
    }

    const result = await this.requestWithRetry(async () => {
      const response = await this.client.get<CNJSearchResult>(
        '/api/v1/publicacoes',
        { params }
      );
      return response.data;
    });

    cache.set(cacheKey, result);

    loggerApi.info({
      cpf,
      total: result.total,
      publications: result.publicacoes.length,
    }, 'CNJ CPF search completed');

    return result;
  }

  /**
   * Lista publicacoes recentes
   */
  async getRecentPublications(days: number = 7): Promise<CNJSearchResult> {
    const dateTo = new Date();
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - days);

    const cacheKey = `recent:${days}:${dateFrom.toISOString().split('T')[0]}`;

    const cached = cache.get<CNJSearchResult>(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await this.requestWithRetry(async () => {
      const response = await this.client.get<CNJSearchResult>(
        '/api/v1/publicacoes',
        {
          params: {
            dataInicio: dateFrom.toISOString().split('T')[0],
            dataFim: dateTo.toISOString().split('T')[0],
          },
        }
      );
      return response.data;
    });

    cache.set(cacheKey, result);

    return result;
  }

  /**
   * Limpa o cache
   */
  clearCache(): void {
    cache.clear();
    loggerApi.info('CNJ API cache cleared');
  }

  /**
   * Verifica saude da API
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.get('/api/v1/health', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton
export const cnjApi = new CNJComunicaClient();

export default cnjApi;
