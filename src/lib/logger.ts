/**
 * DJEN Monitor - Logger Estruturado
 * Usa Pino para logs de alta performance
 */

import pino from 'pino';

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const NODE_ENV = process.env.NODE_ENV || 'development';

export const logger = pino({
  level: LOG_LEVEL,
  transport: NODE_ENV === 'development'
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  base: {
    service: 'djen-monitor',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Loggers especializados para diferentes módulos
export const loggerCron = logger.child({ module: 'cron' });
export const loggerApi = logger.child({ module: 'api' });
export const loggerSearch = logger.child({ module: 'search' });
export const loggerNotify = logger.child({ module: 'notify' });
export const loggerWebhook = logger.child({ module: 'webhook' });

export default logger;
