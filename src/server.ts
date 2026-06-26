/**
 * DJEN Monitor - API REST Server
 * Express server com health check e endpoints admin
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { z } from 'zod';
import { prisma } from './lib/prisma.js';
import { logger } from './lib/logger.js';
import { startScheduler, stopScheduler, getJobsStatus, runJob } from './cron/scheduler.js';
import { getPublicationsByLawyer } from './services/djen-search.js';
import { processPendingNotifications, getNotificationStats } from './services/notifications.js';

// ===========================================
// Config
// ===========================================

const PORT = parseInt(process.env.PORT || '3001', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';

// ===========================================
// App
// ===========================================

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.info({ method: req.method, path: req.path }, 'HTTP Request');
  next();
});

// ===========================================
// Schemas de validacao
// ===========================================

const LawyerSearchSchema = z.object({
  oabNumber: z.string().min(1),
  oabState: z.string().length(2),
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  doubleTerm: z.boolean().default(false),
});

const PublicationQuerySchema = z.object({
  lawyerId: z.string().optional(),
  urgencyLevel: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

// ===========================================
// Endpoints
// ===========================================

// ----- Health Check -----

app.get('/health', async (req: Request, res: Response) => {
  try {
    const checks: Record<string, string> = {};
    let allHealthy = true;

    // Verifica conexao com banco (com timeout)
    try {
      await Promise.race([
        prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('DB timeout')), 5000)
        ),
      ]);
      checks.database = 'connected';
    } catch (dbError) {
      checks.database = 'disconnected';
      allHealthy = false;
      logger.warn({ error: dbError }, 'Database health check failed');
    }

    // Verifica status dos jobs
    let jobs: any = { scheduled: 0, running: false };
    try {
      jobs = getJobsStatus();
    } catch (jobError) {
      logger.warn({ error: jobError }, 'Jobs status check failed');
    }

    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
      database: checks.database,
      jobs,
      environment: NODE_ENV,
      port: PORT,
    });
  } catch (error) {
    logger.error({ error }, 'Health check failed');
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ----- Admin: Executar busca agora -----

app.post('/admin/search-now', async (req: Request, res: Response) => {
  try {
    logger.info({}, 'Admin: forcando busca diaria');

    // Executa em background
    runJob('daily').catch((error) => {
      logger.error({ error }, 'Erro ao executar busca diaria');
    });

    res.json({
      success: true,
      message: 'Busca diaria iniciada em background',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ error }, 'Erro ao iniciar busca');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ----- Admin: Forcar envio de notificacoes -----

app.post('/admin/notify-pending', async (req: Request, res: Response) => {
  try {
    logger.info({}, 'Admin: forçando envio de notificacoes');

    const stats = await processPendingNotifications();

    res.json({
      success: true,
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ error }, 'Erro ao processar notificacoes');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ----- Admin: Listar publicacoes -----

app.get('/admin/publications', async (req: Request, res: Response) => {
  try {
    const query = PublicationQuerySchema.parse(req.query);

    let result;

    if (query.lawyerId) {
      result = await getPublicationsByLawyer(query.lawyerId, {
        limit: query.limit,
        offset: query.offset,
        urgencyLevel: query.urgencyLevel,
        dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
        dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
      });
    } else {
      const [publications, total] = await Promise.all([
        prisma.publication.findMany({
          where: {
            ...(query.urgencyLevel && { urgencyLevel: query.urgencyLevel }),
            ...(query.dateFrom && { publicationDate: { gte: new Date(query.dateFrom) } }),
            ...(query.dateTo && { publicationDate: { lte: new Date(query.dateTo) } }),
          },
          include: {
            lawyer: { select: { id: true, name: true, oabNumber: true, oabState: true } },
          },
          orderBy: { publicationDate: 'desc' },
          take: query.limit,
          skip: query.offset,
        }),
        prisma.publication.count({
          where: {
            ...(query.urgencyLevel && { urgencyLevel: query.urgencyLevel }),
          },
        }),
      ]);

      result = { publications, total };
    }

    res.json({
      success: true,
      data: result.publications,
      pagination: {
        total: result.total,
        limit: query.limit,
        offset: query.offset,
        hasMore: query.offset + result.publications.length < result.total,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        errors: error.issues,
      });
      return;
    }

    logger.error({ error }, 'Erro ao buscar publicacoes');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ----- Admin: Estatisticas -----

app.get('/admin/stats', async (req: Request, res: Response) => {
  try {
    const [
      lawyersCount,
      publicationsCount,
      pendingNotifications,
      syncedPublications,
      unsyncedPublications,
      notificationsStats,
      jobsStatus,
      recentPublications,
    ] = await Promise.all([
      prisma.lawyer.count({ where: { status: 'ACTIVE' } }),
      prisma.publication.count(),
      prisma.notification.count({ where: { status: 'PENDING' } }),
      prisma.publication.count({ where: { syncedToJurisAgenda: true } }),
      prisma.publication.count({ where: { syncedToJurisAgenda: false } }),
      getNotificationStats(),
      Promise.resolve(getJobsStatus()),
      prisma.publication.findMany({
        take: 5,
        orderBy: { publicationDate: 'desc' },
        include: {
          lawyer: { select: { name: true, oabNumber: true } },
        },
      }),
    ]);

    res.json({
      success: true,
      stats: {
        lawyers: lawyersCount,
        publications: publicationsCount,
        notifications: {
          ...notificationsStats,
          pending: pendingNotifications,
        },
        sync: {
          synced: syncedPublications,
          pending: unsyncedPublications,
        },
        jobs: jobsStatus,
        recentPublications,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ error }, 'Erro ao buscar estatisticas');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ----- Admin: Listar advogados -----

app.get('/admin/lawyers', async (req: Request, res: Response) => {
  try {
    const lawyers = await prisma.lawyer.findMany({
      include: {
        _count: {
          select: {
            publications: true,
            searches: true,
          },
        },
        publications: {
          take: 5,
          orderBy: { publicationDate: 'desc' },
          select: {
            id: true,
            actType: true,
            publicationDate: true,
            urgencyLevel: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    res.json({
      success: true,
      data: lawyers,
    });
  } catch (error) {
    logger.error({ error }, 'Erro ao buscar advogados');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ----- Admin: Criar advogado -----

app.post('/admin/lawyers', async (req: Request, res: Response) => {
  try {
    const data = LawyerSearchSchema.parse(req.body);

    const lawyer = await prisma.lawyer.create({
      data: {
        oabNumber: data.oabNumber,
        oabState: data.oabState.toUpperCase(),
        name: data.name,
        email: data.email,
        phone: data.phone,
        doubleTerm: data.doubleTerm,
      },
    });

    // Cria busca padrao
    await prisma.lawyerSearch.create({
      data: {
        lawyerId: lawyer.id,
        query: lawyer.oabNumber,
        searchType: 'OAB',
        frequency: 'DAILY',
        active: true,
      },
    });

    res.status(201).json({
      success: true,
      data: lawyer,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        errors: error.issues,
      });
      return;
    }

    logger.error({ error }, 'Erro ao criar advogado');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ----- Admin: Ver logs de execucao -----

app.get('/admin/cron-logs', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string || '20', 10), 100);

    const logs = await prisma.cronJob.findMany({
      orderBy: { lastRunAt: 'desc' },
      take: limit,
    });

    res.json({
      success: true,
      data: logs,
    });
  } catch (error) {
    logger.error({ error }, 'Erro ao buscar logs');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ===========================================
// Error handler
// ===========================================

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ error: err, path: req.path }, 'Unhandled error');
  res.status(500).json({
    success: false,
    error: NODE_ENV === 'development' ? err.message : 'Internal server error',
  });
});

// ===========================================
// 404 handler
// ===========================================

app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path,
  });
});

// ===========================================
// Start/Stop server
// ===========================================

let server: ReturnType<typeof app.listen> | null = null;

export async function startServer(): Promise<void> {
  return new Promise((resolve) => {
    server = app.listen(PORT, '0.0.0.0', () => {
      logger.info({ port: PORT, env: NODE_ENV }, 'DJEN Monitor API started');
      console.log(`DJEN Monitor API running on http://0.0.0.0:${PORT}`);
      console.log(`Health check: http://0.0.0.0:${PORT}/health`);

      // Inicia scheduler
      if (NODE_ENV === 'production' || process.env.ENABLE_CRON === 'true') {
        startScheduler();
      }

      resolve();
    });
  });
}

export async function stopServer(): Promise<void> {
  logger.info('Parando servidor');

  // Para scheduler
  stopScheduler();

  // Fecha server
  if (server) {
    await new Promise<void>((resolve) => {
      server!.close(() => resolve());
    });
    server = null;
  }

  // Desconecta do banco
  await prisma.$disconnect();

  logger.info('Servidor parado');
}

// ===========================================
// Graceful shutdown
// ===========================================

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received');
  await stopServer();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received');
  await stopServer();
  process.exit(0);
});

// ===========================================
// Auto-start em modo standalone
// ===========================================

if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  startServer().catch((error) => {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  });
}

export default app;
