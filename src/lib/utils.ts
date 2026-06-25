/**
 * DJEN Monitor - Utilitários
 * Funções auxiliares reutilizáveis
 */

/**
 * Formata um número de OAB para o formato padrão
 * Remove pontos, espaços e zeros à esquerda
 */
export function formatOABNumber(oab: string): string {
  return oab.replace(/[^0-9]/g, '').replace(/^0+/, '') || oab;
}

/**
 * Formata um número de telefone para formato internacional
 */
export function formatPhoneNumber(phone: string): string {
  // Remove todos os caracteres não numéricos
  const numbers = phone.replace(/\D/g, '');

  // Se já tem código do país, retorna
  if (numbers.length === 13 && numbers.startsWith('55')) {
    return `+${numbers}`;
  }

  // Se tem 10 ou 11 dígitos (sem código do país), adiciona 55
  if (numbers.length >= 10 && numbers.length <= 11) {
    return `+55${numbers}`;
  }

  // Retorna como está se não conseguir formatar
  return phone;
}

/**
 * Valida formato de OAB brasileiro
 * Padrão: NNNNNN (6 dígitos) + UF (2 letras)
 */
export function isValidOAB(oab: string): boolean {
  const cleaned = oab.replace(/\s/g, '');
  // OAB pode ter formato: 123456SP ou 123.456SP ou 123456/SP
  const pattern = /^\d{1,6}[A-Z]{2}$/i;
  return pattern.test(cleaned);
}

/**
 * Extrai o número CNJ de uma string
 * Formato: NNNNNN-DD.AAAA.J.TR0000
 */
export function extractCNJNumber(text: string): string | null {
  const pattern = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/;
  const match = text.match(pattern);
  return match ? match[0] : null;
}

/**
 * Limpa texto removendo múltiplos espaços e quebras de linha
 */
export function cleanText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n+/g, ' ')
    .trim();
}

/**
 * Trunca texto para um tamanho máximo
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Gera um hash simples para deduplicação
 */
export function simpleHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Verifica se uma data é dia útil (não fim de semana, não feriado)
 */
export function isBusinessDay(date: Date, holidays: Date[] = []): boolean {
  const dayOfWeek = date.getDay();
  // 0 = domingo, 6 = sábado
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }

  // Verifica feriados
  const dateStr = date.toISOString().split('T')[0];
  for (const holiday of holidays) {
    if (holiday.toISOString().split('T')[0] === dateStr) {
      return false;
    }
  }

  return true;
}

/**
 * Adiciona dias úteis a uma data
 */
export function addBusinessDays(
  date: Date,
  days: number,
  holidays: Date[] = []
): Date {
  const result = new Date(date);
  let addedDays = 0;

  while (addedDays < days) {
    result.setDate(result.getDate() + 1);
    if (isBusinessDay(result, holidays)) {
      addedDays++;
    }
  }

  return result;
}

/**
 * Calcula diferença em dias úteis entre duas datas
 */
export function businessDaysDiff(
  start: Date,
  end: Date,
  holidays: Date[] = []
): number {
  let count = 0;
  const current = new Date(start);

  while (current < end) {
    current.setDate(current.getDate() + 1);
    if (isBusinessDay(current, holidays)) {
      count++;
    }
  }

  return count;
}

/**
 * Retorna o primeiro dia útil a partir de uma data
 */
export function nextBusinessDay(date: Date, holidays: Date[] = []): Date {
  const result = new Date(date);
  while (!isBusinessDay(result, holidays)) {
    result.setDate(result.getDate() + 1);
  }
  return result;
}

/**
 * Formata data para exibição em português brasileiro
 */
export function formatDateBR(date: Date): string {
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Formata data e hora para exibição em português brasileiro
 */
export function formatDateTimeBR(date: Date): string {
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Sleep helper para delays em Promises
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry com exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

/**
 * Agrupa array por chave
 */
export function groupBy<T, K extends string | number>(
  array: T[],
  keyFn: (item: T) => K
): Record<K, T[]> {
  return array.reduce((result, item) => {
    const key = keyFn(item);
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(item);
    return result;
  }, {} as Record<K, T[]>);
}
