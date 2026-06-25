/**
 * DJEN Monitor - Cron Scheduler
 * Gerencia jobs agendados com node-cron
 */

import cron, { ScheduledTask } from 'node-cron';
import { prisma } from '../lib/prisma.js';
import { loggerCron } from '../lib/logger.js';
import { runDailySearch, syncPendingPublications } from '../services/djen-search.js';
import { processPendingNotifications } from '../services/notifications.js';
import { clearHolidayCache } from '../services/deadline-calculator.js';

// ===========================================
// Schedules padrao
// ===========================================

const SCHEDULE_DAILY_SEARCH = process.env.CRON_DAILY_SEARCH || '0 7 * * 1-5'; // Seg-Sex 7h
const SCHEDULE_NOTIFY = process.env.CRON_NOTIFY_PROCESSOR || '0 */4 * * *'; // A cada 4h
const SCHEDULE_HOLIDAYS = process.env.CRON_HOLIDAYS_UPDATE || '0 0 1 1 *'; // 1 Jan

// ===========================================
// Estado dos jobs
// ===========================================

interface JobState {
  task: ScheduledTask | null;
  running: boolean;
  lastRun: Date | null;
  nextRun: Date | null;
}

const jobs: Record<string, JobState> = {
  dailySearch: { task: null, running: false, lastRun: null, nextRun: null },
  notifyProcessor: { task: null, running: false, lastRun: null, nextRun: null },
  holidaysUpdate: { task: null, running: false, lastRun: null, nextRun: null },
};

// ===========================================
// Jobs handlers
// ===========================================

/**
 * Job: Busca diaria DJEN
 */
async function runDailySearchJob(): Promise<void> {
  if (jobs.dailySearch.running) {
    loggerCron.warn('Job dailySearch ja esta em execucao, pulando');
    return;
  }

  jobs.dailySearch.running = true;
  const startTime = Date.now();

  // Registra inicio
  await prisma.cronJob.upsert({
    where: { name: 'dailySearch' },
    update: { status: 'RUNNING', lastRunAt: new Date() },
    create: { name: 'dailySearch', status: 'RUNNING', lastRunAt: new Date() },
  });

  loggerCron.info('Iniciando job dailySearch');

  try {
    const stats = await runDailySearch();

    // Registra sucesso
    await prisma.cronJob.update({
      where: { name: 'dailySearch' },
      data: {
        status: 'SUCCESS',
        lastRunAt: new Date(),
        duration: Date.now() - startTime,
      },
    });

    loggerCron.info({
      ...stats,
      duration: Date.now() - startTime,
    }, 'Job dailySearch concluido com sucesso');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await prisma.cronJob.update({
      where: { name: 'dailySearch' },
      data: {
        status: 'FAILED',
        errorMessage,
        duration: Date.now() - startTime,
      },
    });

    loggerCron.error({ error: errorMessage }, 'Job dailySearch falhou');
  } finally {
    jobs.dailySearch.running = false;
    jobs.dailySearch.lastRun = new Date();
  }
}

/**
 * Job: Processador de notificacoes
 */
async function runNotifyProcessorJob(): Promise<void> {
  if (jobs.notifyProcessor.running) {
    loggerCron.warn('Job notifyProcessor ja esta em execucao, pulando');
    return;
  }

  jobs.notifyProcessor.running = true;
  const startTime = Date.now();

  await prisma.cronJob.upsert({
    where: { name: 'notifyProcessor' },
    update: { status: 'RUNNING', lastRunAt: new Date() },
    create: { name: 'notifyProcessor', status: 'RUNNING', lastRunAt: new Date() },
  });

  loggerCron.info('Iniciando job notifyProcessor');

  try {
    const stats = await processPendingNotifications();

    await prisma.cronJob.update({
      where: { name: 'notifyProcessor' },
      data: {
        status: 'SUCCESS',
        lastRunAt: new Date(),
        duration: Date.now() - startTime,
      },
    });

    loggerCron.info({
      ...stats,
      duration: Date.now() - startTime,
    }, 'Job notifyProcessor concluido');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await prisma.cronJob.update({
      where: { name: 'notifyProcessor' },
      data: {
        status: 'FAILED',
        errorMessage,
        duration: Date.now() - startTime,
      },
    });

    loggerCron.error({ error: errorMessage }, 'Job notifyProcessor falhou');
  } finally {
    jobs.notifyProcessor.running = false;
    jobs.notifyProcessor.lastRun = new Date();
  }
}

/**
 * Job: Atualizacao de feriados
 */
async function runHolidaysUpdateJob(): Promise<void> {
  if (jobs.holidaysUpdate.running) {
    loggerCron.warn('Job holidaysUpdate ja esta em execucao, pulando');
    return;
  }

  jobs.holidaysUpdate.running = true;
  const startTime = Date.now();

  await prisma.cronJob.upsert({
    where: { name: 'holidaysUpdate' },
    update: { status: 'RUNNING', lastRunAt: new Date() },
    create: { name: 'holidaysUpdate', status: 'RUNNING', lastRunAt: new Date() },
  });

  loggerCron.info('Iniciando job holidaysUpdate');

  try {
    // Limpa cache de feriados
    clearHolidayCache();

    // Aqui voce pode adicionar logica para buscar feriados de uma API externa
    // Por exemplo: https://www.anbima.com.br/feriados/nacionais

    await prisma.cronJob.update({
      where: { name: 'holidaysUpdate' },
      data: {
        status: 'SUCCESS',
        lastRunAt: new Date(),
        duration: Date.now() - startTime,
      },
    });

    loggerCron.info({ duration: Date.now() - startTime }, 'Job holidaysUpdate concluido');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await prisma.cronJob.update({
      where: { name: 'holidaysUpdate' },
      data: {
        status: 'FAILED',
        errorMessage,
        duration: Date.now() - startTime,
      },
    });

    loggerCron.error({ error: errorMessage }, 'Job holidaysUpdate falhou');
  } finally {
    jobs.holidaysUpdate.running = false;
    jobs.holidaysUpdate.lastRun = new Date();
  }
}

/**
 * Job: Sincronizacao com Juris Agenda
 */
async function runSyncJob(): Promise<void> {
  loggerCron.info('Iniciando sincronizacao com Juris Agenda');

  try {
    const synced = await syncPendingPublications();
    loggerCron.info({ synced }, 'Sincronizacao concluida');
  } catch (error) {
    loggerCron.error({ error }, 'Sincronizacao falhou');
  }
}

// ===========================================
// Scheduler controls
// ===========================================

/**
 * Inicializa todos os jobs cron
 */
export function startScheduler(): void {
  loggerCron.info('Iniciando scheduler de jobs');

  // Busca diaria - Seg-Sex as 7h
  jobs.dailySearch.task = cron.schedule(SCHEDULE_DAILY_SEARCH, runDailySearchJob, {
    scheduled: true,
    timezone: 'America/Sao_Paulo',
  });
  loggerCron.info({ schedule: SCHEDULE_DAILY_SEARCH }, 'Job dailySearch agendado');

  // Processador de notificacoes - A cada 4h
  jobs.notifyProcessor.task = cron.schedule(SCHEDULE_NOTIFY, runNotifyProcessorJob, {
    scheduled: true,
    timezone: 'America/Sao_Paulo',
  });
  loggerCron.info({ schedule: SCHEDULE_NOTIFY }, 'Job notifyProcessor agendado');

  // Atualizacao de feriados - 1 Jan
  jobs.holidaysUpdate.task = cron.schedule(SCHEDULE_HOLIDAYS, runHolidaysUpdateJob, {
    scheduled: true,
    timezone: 'America/Sao_Paulo',
  });
  loggerCron.info({ schedule: SCHEDULE_HOLIDAYS }, 'Job holidaysUpdate agendado');

  // Atualiza proximas execucoes
  updateNextRunTimes();

  loggerCron.info('Scheduler iniciado com sucesso');
}

/**
 * Para todos os jobs cron
 */
export function stopScheduler(): void {
  loggerCron.info('Parando scheduler');

  for (const [name, state] of Object.entries(jobs)) {
    if (state.task) {
      state.task.stop();
      state.task = null;
      loggerCron.info({ job: name }, 'Job parado');
    }
  }
}

/**
 * Atualiza horarios de proxima execucao
 */
function updateNextRunTimes(): void {
  const now = new Date();

  if (jobs.dailySearch.task) {
    // Estima proximo basedo no schedule
    jobs.dailySearch.nextRun = getNextRunFromSchedule(SCHEDULE_DAILY_SEARCH, now);
  }
  if (jobs.notifyProcessor.task) {
    jobs.notifyProcessor.nextRun = getNextRunFromSchedule(SCHEDULE_NOTIFY, now);
  }
  if (jobs.holidaysUpdate.task) {
    jobs.holidaysUpdate.nextRun = getNextRunFromSchedule(SCHEDULE_HOLIDAYS, now);
  }
}

/**
 * Estima proxima execucao a partir do cron schedule
 */
function getNextRunFromSchedule(schedule: string, from: Date): Date {
  // Implementacao simples - em producao use cron-parser
  const parts = schedule.split(' ');
  if (parts.length < 5) return new Date(from.getTime() + 24 * 60 * 60 * 1000);

  // Retorna data aproximada
  const next = new Date(from);
  next.setHours(next.getHours() + 1);
  return next;
}

/**
 * Executa um job especifico manualmente
 */
export async function runJob(jobName: string): Promise<void> {
  switch (jobName) {
    case 'daily':
    case 'dailySearch':
      await runDailySearchJob();
      break;
    case 'notify':
    case 'notifyProcessor':
      await runNotifyProcessorJob();
      break;
    case 'holidays':
    case 'holidaysUpdate':
      await runHolidaysUpdateJob();
      break;
    case 'sync':
      await runSyncJob();
      break;
    default:
      throw new Error('Job desconhecido: ' + jobName);
  }
}

/**
 * Obtem status dos jobs
 */
export function getJobsStatus(): Record<string, {
  running: boolean;
  lastRun: string | null;
  nextRun: string | null;
}> {
  return {
    dailySearch: {
      running: jobs.dailySearch.running,
      lastRun: jobs.dailySearch.lastRun?.toISOString() || null,
      nextRun: jobs.dailySearch.nextRun?.toISOString() || null,
    },
    notifyProcessor: {
      running: jobs.notifyProcessor.running,
      lastRun: jobs.notifyProcessor.lastRun?.toISOString() || null,
      nextRun: jobs.notifyProcessor.nextRun?.toISOString() || null,
    },
    holidaysUpdate: {
      running: jobs.holidaysUpdate.running,
      lastRun: jobs.holidaysUpdate.lastRun?.toISOString() || null,
      nextRun: jobs.holidaysUpdate.nextRun?.toISOString() || null,
    },
  };
}

export default {
  startScheduler,
  stopScheduler,
  runJob,
  getJobsStatus,
};
