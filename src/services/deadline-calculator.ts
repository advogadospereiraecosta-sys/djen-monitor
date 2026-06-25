/**
 * DJEN Monitor - Calculadora de Prazos Processuais
 * Implementacao conforme CPC 219, 224, 231, 183, 186
 */

import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

// ===========================================
// Tipos
// ===========================================

export interface DeadlineResult {
  fictionalDate: Date | null;
  fatalDeadline: Date | null;
  warningDate: Date | null;
  baseDeadlineDays: number;
  totalDeadlineDays: number;
  hasDoubleTerm: boolean;
  warnings: string[];
}

interface HolidayData {
  date: Date;
  name: string;
  state: string | null;
}

// ===========================================
// Constantes
// ===========================================

// Recesso forense (CPC 220)
const RECESSO_START_MONTH = 11; // Dezembro
const RECESSO_START_DAY = 20;
const RECESSO_END_MONTH = 0; // Janeiro
const RECESSO_END_DAY = 20;

// Warning anteciapdo padrao (dias antes do prazo fatal)
const WARNING_DAYS_ADVANCE = 3;

// ===========================================
// Cache de feriados
// ===========================================

let cachedHolidays: HolidayData[] | null = null;
let holidaysCacheTime: number = 0;
const HOLIDAYS_CACHE_TTL = 60 * 60 * 1000; // 1 hora

/**
 * Obtem feriados do banco de dados
 */
async function getHolidays(state?: string): Promise<HolidayData[]> {
  const now = Date.now();

  // Usa cache se disponivel
  if (cachedHolidays && (now - holidaysCacheTime) < HOLIDAYS_CACHE_TTL) {
    return cachedHolidays.filter(h => !state || !h.state || h.state === state);
  }

  // Busca do banco
  const holidays = await prisma.holiday.findMany({
    where: state ? { OR: [{ state: null }, { state }] } : undefined,
  });

  cachedHolidays = holidays.map(h => ({
    date: h.date,
    name: h.name,
    state: h.state,
  }));

  holidaysCacheTime = now;

  return cachedHolidays.filter(h => !state || !h.state || h.state === state);
}

/**
 * Limpa cache de feriados
 */
export function clearHolidayCache(): void {
  cachedHolidays = null;
  holidaysCacheTime = 0;
}

/**
 * Verifica se uma data e dia util
 */
export function isBusinessDay(date: Date, holidays: HolidayData[] = []): boolean {
  const dayOfWeek = date.getDay();

  // Fim de semana: 0 = domingo, 6 = sabado
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }

  // Verifica recesso forense (CPC 220)
  const month = date.getMonth();
  const day = date.getDate();

  if (month === RECESSO_START_MONTH && day >= RECESSO_START_DAY) {
    return false;
  }
  if (month === RECESSO_END_MONTH && day <= RECESSO_END_DAY) {
    return false;
  }

  // Verifica feriados
  const dateStr = date.toISOString().split('T')[0];
  for (const holiday of holidays) {
    const holidayStr = holiday.date.toISOString().split('T')[0];
    if (dateStr === holidayStr) {
      return false;
    }
  }

  return true;
}

/**
 * Obtem proximo dia util
 */
export function getNextBusinessDay(date: Date, holidays: HolidayData[] = []): Date {
  const result = new Date(date);

  // Avanca para o proximo dia
  result.setDate(result.getDate() + 1);

  // Busca dia util
  while (!isBusinessDay(result, holidays)) {
    result.setDate(result.getDate() + 1);
  }

  return result;
}

/**
 * Adiciona dias uteis a uma data (CPC 219)
 */
export function addBusinessDays(
  startDate: Date,
  days: number,
  holidays: HolidayData[] = []
): Date {
  if (days <= 0) {
    return new Date(startDate);
  }

  const result = new Date(startDate);
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
 * Conta dias uteis entre duas datas
 */
export function countBusinessDays(
  startDate: Date,
  endDate: Date,
  holidays: HolidayData[] = []
): number {
  if (endDate <= startDate) {
    return 0;
  }

  let count = 0;
  const current = new Date(startDate);

  while (current < endDate) {
    current.setDate(current.getDate() + 1);

    if (isBusinessDay(current, holidays)) {
      count++;
    }
  }

  return count;
}

/**
 * Calcula data de ciencia ficta (CPC 231)
 * Publicacao + 10 dias uteis
 */
export function calculateFictionalDate(
  publicationDate: Date,
  holidays: HolidayData[] = []
): Date {
  const result = addBusinessDays(publicationDate, 10, holidays);

  logger.debug({
    publicationDate: publicationDate.toISOString(),
    fictionalDate: result.toISOString(),
  }, 'Calculated fictional date (CPC 231)');

  return result;
}

/**
 * Calcula prazo fatal (data de encerramento do prazo)
 * Considera CPC 183 (Fazenda) e CPC 186 (Defensoria)
 */
export function calculateFatalDeadline(
  publicationDate: Date,
  baseDays: number,
  doubleTerm: boolean = false,
  holidays: HolidayData[] = []
): Date {
  if (baseDays <= 0) {
    return publicationDate;
  }

  // Aplica dobro do prazo se aplicavel (CPC 183, 186)
  const totalDays = doubleTerm ? baseDays * 2 : baseDays;

  // Adiciona dias uteis
  const deadline = addBusinessDays(publicationDate, totalDays, holidays);

  // Se terminar em fim de semana/feriado, move para primeiro dia util seguinte (CPC 224)
  if (!isBusinessDay(deadline, holidays)) {
    const adjusted = getNextBusinessDay(deadline, holidays);
    logger.debug({
      original: deadline.toISOString(),
      adjusted: adjusted.toISOString(),
    }, 'Adjusted deadline to next business day (CPC 224)');
    return adjusted;
  }

  logger.debug({
    publicationDate: publicationDate.toISOString(),
    baseDays,
    doubleTerm,
    totalDays,
    fatalDeadline: deadline.toISOString(),
  }, 'Calculated fatal deadline');

  return deadline;
}

/**
 * Calcula data de alerta antecipado
 * Fatal deadline - 3 dias uteis (CPC 219 paragrafo unico)
 */
export function calculateWarningDate(
  fatalDeadline: Date,
  daysAdvance: number = WARNING_DAYS_ADVANCE,
  holidays: HolidayData[] = []
): Date {
  const result = new Date(fatalDeadline);
  let subtractedDays = 0;

  while (subtractedDays < daysAdvance) {
    result.setDate(result.getDate() - 1);

    if (isBusinessDay(result, holidays)) {
      subtractedDays++;
    }
  }

  logger.debug({
    fatalDeadline: fatalDeadline.toISOString(),
    warningDate: result.toISOString(),
  }, 'Calculated warning date');

  return result;
}

/**
 * Calcula todos os prazos de uma publicacao
 */
export async function calculateDeadlines(
  publicationDate: Date,
  baseDeadlineDays: number,
  doubleTerm: boolean,
  state?: string
): Promise<DeadlineResult> {
  const warnings: string[] = [];

  // Obtem feriados
  const holidays = await getHolidays(state);

  // Verifica se publication date e dia util
  if (!isBusinessDay(publicationDate, holidays)) {
    warnings.push('Data de publicacao nao e dia util - usando proximo dia util');
  }

  // Calcula ciencia ficta
  const fictionalDate = calculateFictionalDate(publicationDate, holidays);

  // Calcula prazo fatal
  const fatalDeadline = calculateFatalDeadline(
    publicationDate,
    baseDeadlineDays,
    doubleTerm,
    holidays
  );

  // Calcula data de alerta
  const warningDate = calculateWarningDate(fatalDeadline, WARNING_DAYS_ADVANCE, holidays);

  // Verifica se prazo fatal ja passou
  const now = new Date();
  if (fatalDeadline < now) {
    warnings.push('PRAZO JA VENCEU');
  } else {
    const daysRemaining = countBusinessDays(now, fatalDeadline, holidays);
    warnings.push(`Dias restantes: ${daysRemaining}`);
  }

  const totalDays = doubleTerm ? baseDeadlineDays * 2 : baseDeadlineDays;

  return {
    fictionalDate,
    fatalDeadline,
    warningDate,
    baseDeadlineDays,
    totalDeadlineDays: totalDays,
    hasDoubleTerm: doubleTerm,
    warnings,
  };
}

/**
 * Formata resultado de prazo para exibicao
 */
export function formatDeadlineResult(result: DeadlineResult): string {
  const parts: string[] = [];

  if (result.fictionalDate) {
    parts.push(`Ciencia Ficta: ${result.fictionalDate.toLocaleDateString('pt-BR')}`);
  }

  if (result.fatalDeadline) {
    parts.push(`Prazo Fatal: ${result.fatalDeadline.toLocaleDateString('pt-BR')}`);
  }

  if (result.warningDate) {
    parts.push(`Alerta: ${result.warningDate.toLocaleDateString('pt-BR')}`);
  }

  parts.push(`Dias: ${result.baseDeadlineDays}${result.hasDoubleTerm ? ' (dobro)' : ''}`);

  if (result.warnings.length > 0) {
    parts.push(`Avisos: ${result.warnings.join(', ')}`);
  }

  return parts.join(' | ');
}

/**
 * Verifica se uma publicacao esta proxima do vencimento
 */
export function isNearDeadline(
  fatalDeadline: Date,
  warningDays: number = 3,
  holidays: HolidayData[] = []
): boolean {
  const now = new Date();
  const warningThreshold = calculateWarningDate(fatalDeadline, warningDays, holidays);
  return now >= warningThreshold && fatalDeadline > now;
}

/**
 * Verifica se uma publicacao ja venceu
 */
export function isPastDeadline(fatalDeadline: Date): boolean {
  const now = new Date();
  return fatalDeadline < now;
}

export default {
  calculateDeadlines,
  calculateFictionalDate,
  calculateFatalDeadline,
  calculateWarningDate,
  isBusinessDay,
  addBusinessDays,
  countBusinessDays,
  getHolidays,
  clearHolidayCache,
  isNearDeadline,
  isPastDeadline,
  formatDeadlineResult,
};
