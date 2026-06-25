/**
 * DJEN Monitor - CLI Entry Point
 * Ponto de entrada para comandos CLI e execucao de cron jobs
 */

import { parseArgs } from 'node:util';
import { prisma } from './lib/prisma.js';
import { logger, loggerCron } from './lib/logger.js';
import { startScheduler, stopScheduler, runJob } from './cron/scheduler.js';

// ===========================================
// Parse de argumentos
// ===========================================

interface CliArgs {
  command?: string;
  jobName?: string;
  help?: boolean;
}

function parseCliArgs(): CliArgs {
  const { values, positionals } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  const command = positionals[0];
  const jobName = positionals[1];

  return {
    command,
    jobName,
    help: values.help || false,
  };
}

// ===========================================
// Comandos
// ===========================================

const HELP_TEXT = `
DJEN Monitor - CLI

Usage:
  node dist/index.js [command] [job]

Commands:
  cron <job>      Executa um job cron especifico
                  Jobs disponiveis:
                    - daily, dailySearch: Busca diaria DJEN
                    - notify, notifyProcessor: Processa notificacoes pendentes
                    - holidays, holidaysUpdate: Atualiza feriados
                    - sync: Sincroniza com Juris Agenda
  server          Inicia o servidor API
  help            Mostra esta ajuda

Examples:
  node dist/index.js cron daily
  node dist/index.js cron notify
  node dist/index.js server
`;

async function showHelp(): Promise<void> {
  console.log(HELP_TEXT);
}

/**
 * Executa um job cron
 */
async function executeCronJob(jobName: string): Promise<void> {
  loggerCron.info({ job: jobName }, 'Executando job via CLI');

  try {
    await runJob(jobName);
    loggerCron.info({ job: jobName }, 'Job executado com sucesso');
  } catch (error) {
    loggerCron.error({
      job: jobName,
      error: error instanceof Error ? error.message : String(error),
    }, 'Job falhou');
    process.exit(1);
  }
}

/**
 * Inicia o servidor (importacao tardia para evitar circular)
 */
async function startServer(): Promise<void> {
  // Importacao dinamica para evitar problemas com node_modules
  const { startServer } = await import('./server.js');
  await startServer();
}

// ===========================================
// Main
// ===========================================

async function main(): Promise<void> {
  const args = parseCliArgs();

  if (args.help) {
    await showHelp();
    process.exit(0);
  }

  const command = args.command;

  if (!command) {
    console.error('Comando nao especificado. Use --help para ajuda.');
    process.exit(1);
  }

  try {
    switch (command.toLowerCase()) {
      case 'cron':
        if (!args.jobName) {
          console.error('Nome do job nao especificado. Use --help para ajuda.');
          process.exit(1);
        }
        await executeCronJob(args.jobName.toLowerCase());
        break;

      case 'server':
        await startServer();
        break;

      case 'help':
        await showHelp();
        break;

      default:
        console.error('Comando desconhecido:', command);
        console.error('Use --help para ajuda.');
        process.exit(1);
    }
  } catch (error) {
    logger.error({
      command,
      error: error instanceof Error ? error.message : String(error),
    }, 'Erro fatal');
    process.exit(1);
  } finally {
    // Desconecta do banco ao finalizar
    await prisma.$disconnect();
  }
}

// Executa main
main().catch((error) => {
  console.error('Erro fatal:', error);
  process.exit(1);
});
