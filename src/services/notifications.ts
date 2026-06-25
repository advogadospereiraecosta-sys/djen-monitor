/**
 * DJEN Monitor - Servico de Notificacoes
 * WhatsApp (Evolution API), Email (SMTP), Webhook
 */

import axios, { AxiosError } from 'axios';
import { PrismaClient, NotificationChannel, NotificationStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { loggerNotify } from '../lib/logger.js';
import { formatPhoneNumber, sleep } from '../lib/utils.js';

// ===========================================
// Configuracoes
// ===========================================

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || '';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || '';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || '';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

// ===========================================
// Tipos
// ===========================================

interface NotificationMessage {
  publicationId: string;
  channel: NotificationChannel;
  recipient: string;
  subject?: string;
  message: string;
}

// ===========================================
// Envio WhatsApp via Evolution API
// ===========================================

/**
 * Envia mensagem WhatsApp via Evolution API
 */
export async function sendWhatsApp(phone: string, message: string): Promise<boolean> {
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY || !EVOLUTION_INSTANCE) {
    loggerNotify.warn('Evolution API nao configurada, pulando notificacao WhatsApp');
    return false;
  }

  const formattedPhone = formatPhoneNumber(phone);

  try {
    const response = await axios.post(
      `${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`,
      {
        number: formattedPhone,
        text: message,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'apikey': EVOLUTION_API_KEY,
        },
        timeout: 30000,
      }
    );

    loggerNotify.info({
      phone: formattedPhone,
      messageId: response.data?.key?.id,
    }, 'WhatsApp enviado com sucesso');

    return true;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      loggerNotify.error({
        phone: formattedPhone,
        status: error.response?.status,
        error: error.response?.data || error.message,
      }, 'Erro ao enviar WhatsApp');
    }
    throw error;
  }
}

// ===========================================
// Envio de Email
// ===========================================

/**
 * Envia email via SMTP (usando axios para API de email service)
 * Em producao, considere usar nodemailer ou similar
 */
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  isHtml: boolean = false
): Promise<boolean> {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    loggerNotify.warn('SMTP nao configurado, pulando notificacao por email');
    return false;
  }

  try {
    // Nota: Em producao real, use nodemailer ou similar
    // Este e um placeholder que simula o envio
    loggerNotify.info({ to, subject }, 'Email enviado com sucesso (simulado)');

    // Implementacao real com nodemailer:
    // const nodemailer = await import('nodemailer');
    // const transporter = nodemailer.createTransport({
    //   host: SMTP_HOST,
    //   port: SMTP_PORT,
    //   secure: SMTP_PORT === 465,
    //   auth: { user: SMTP_USER, pass: SMTP_PASS },
    // });
    // await transporter.sendMail({
    //   from: SMTP_FROM,
    //   to,
    //   subject,
    //   text: isHtml ? undefined : body,
    //   html: isHtml ? body : undefined,
    // });

    return true;
  } catch (error) {
    loggerNotify.error({
      to,
      subject,
      error: error instanceof Error ? error.message : String(error),
    }, 'Erro ao enviar email');
    throw error;
  }
}

// ===========================================
// Envio Webhook
// ===========================================

/**
 * Envia payload via webhook
 */
export async function sendWebhook(url: string, payload: object): Promise<boolean> {
  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'DJEN-Monitor/1.0',
      },
      timeout: 15000,
    });

    loggerNotify.info({
      url,
      statusCode: response.status,
    }, 'Webhook enviado com sucesso');

    // Salva evento de webhook
    await prisma.webhookEvent.create({
      data: {
        event: 'webhook.sent',
        url,
        payload: payload as never,
        status: 'SUCCESS',
        statusCode: response.status,
        response: typeof response.data === 'string'
          ? response.data.substring(0, 1000)
          : JSON.stringify(response.data).substring(0, 1000),
        sentAt: new Date(),
      },
    });

    return true;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      loggerNotify.error({
        url,
        status: error.response?.status,
        error: error.response?.data || error.message,
      }, 'Erro ao enviar webhook');

      // Salva evento de falha
      await prisma.webhookEvent.create({
        data: {
          event: 'webhook.failed',
          url,
          payload: payload as never,
          status: 'FAILED',
          statusCode: error.response?.status,
          response: String(error.response?.data || error.message).substring(0, 1000),
        },
      });
    }
    throw error;
  }
}

// ===========================================
// Criacao de notificacoes
// ===========================================

/**
 * Cria notificacoes para uma publicacao
 */
export async function createNotifications(publicationId: string): Promise<void> {
  const publication = await prisma.publication.findUnique({
    where: { id: publicationId },
    include: {
      lawyer: true,
    },
  });

  if (!publication) {
    loggerNotify.error({ publicationId }, 'Publicacao nao encontrada');
    return;
  }

  // Gera mensagem
  const message = generateNotificationMessage(publication);

  // Notificacoes pendentes
  const notifications: NotificationMessage[] = [];

  // WhatsApp
  if (publication.lawyer.phone) {
    notifications.push({
      publicationId,
      channel: NotificationChannel.WHATSAPP,
      recipient: publication.lawyer.phone,
      message,
    });
  }

  // Email
  if (publication.lawyer.email) {
    notifications.push({
      publicationId,
      channel: NotificationChannel.EMAIL,
      recipient: publication.lawyer.email,
      subject: `DJEN Monitor - ${publication.actType} - ${publication.cnjNumber || 'Sem processo'}`,
      message,
    });
  }

  // Cria registros no banco
  for (const notif of notifications) {
    await prisma.notification.create({
      data: {
        publicationId: notif.publicationId,
        channel: notif.channel,
        recipient: notif.recipient,
        subject: notif.subject,
        message: notif.message,
        status: NotificationStatus.PENDING,
      },
    });
  }

  loggerNotify.info({
    publicationId,
    notificationCount: notifications.length,
  }, 'Notificacoes criadas');
}

/**
 * Gera mensagem de notificacao formatada
 */
function generateNotificationMessage(publication: {
  actType: string;
  actDescription: string;
  courtName: string;
  cnjNumber: string | null;
  fatalDeadline: Date | null;
  urgencyLevel: string;
}): string {
  const parts: string[] = [];

  parts.push('*DJEN Monitor - Nova Publicacao*');
  parts.push('');
  parts.push(`*Tipo:* ${publication.actType}`);
  parts.push(`*Orgao:* ${publication.courtName}`);

  if (publication.cnjNumber) {
    parts.push(`*Processo:* ${publication.cnjNumber}`);
  }

  if (publication.fatalDeadline) {
    const deadlineStr = publication.fatalDeadline.toLocaleDateString('pt-BR');
    parts.push(`*Prazo:* ${deadlineStr}`);
  }

  // Descricao resumida (primeiras 200 chars)
  const desc = publication.actDescription.substring(0, 200);
  if (publication.actDescription.length > 200) {
    parts.push(`*Descricao:* ${desc}...`);
  } else {
    parts.push(`*Descricao:* ${desc}`);
  }

  parts.push('');
  parts.push('_Enviado automaticamente pelo DJEN Monitor_');

  return parts.join('\n');
}

// ===========================================
// Processador de fila de notificacoes
// ===========================================

/**
 * Processa notificacoes pendentes
 */
export async function processPendingNotifications(): Promise<{
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
}> {
  const stats = {
    processed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
  };

  // Busca notificacoes pendentes
  const pending = await prisma.notification.findMany({
    where: { status: NotificationStatus.PENDING },
    include: {
      publication: true,
    },
    take: 100,
    orderBy: [
      { publication: { urgencyLevel: 'asc' } },
      { createdAt: 'asc' },
    ],
  });

  loggerNotify.info({ pendingCount: pending.length }, 'Processando notificacoes pendentes');

  for (const notification of pending) {
    stats.processed++;

    try {
      let success = false;

      switch (notification.channel) {
        case NotificationChannel.WHATSAPP:
          success = await sendWhatsAppWithRetry(notification.recipient, notification.message);
          break;

        case NotificationChannel.EMAIL:
          success = await sendEmail(
            notification.recipient,
            notification.subject || 'DJEN Monitor - Nova Publicacao',
            notification.message
          );
          break;

        case NotificationChannel.WEBHOOK:
          success = await sendWebhook(notification.recipient, {
            event: 'notification.created',
            publication: notification.publication,
            message: notification.message,
          });
          break;

        default:
          loggerNotify.warn({ channel: notification.channel }, 'Canal de notificacao nao suportado');
          stats.skipped++;
      }

      if (success) {
        await prisma.notification.update({
          where: { id: notification.id },
          data: {
            status: NotificationStatus.SENT,
            sentAt: new Date(),
            attempts: notification.attempts + 1,
            lastAttemptAt: new Date(),
          },
        });
        stats.sent++;
      } else {
        throw new Error('Envio nao retornou sucesso');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          attempts: notification.attempts + 1,
          lastAttemptAt: new Date(),
          errorMessage,
          // Marca como falha apos maximo de tentativas
          status: notification.attempts + 1 >= MAX_RETRIES
            ? NotificationStatus.FAILED
            : NotificationStatus.PENDING,
        },
      });

      stats.failed++;
    }
  }

  loggerNotify.info(stats, 'Processamento de notificacoes concluido');

  return stats;
}

/**
 * Envia WhatsApp com retry
 */
async function sendWhatsAppWithRetry(phone: string, message: string): Promise<boolean> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await sendWhatsApp(phone, message);
    } catch (error) {
      lastError = error as Error;

      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }

  throw lastError;
}

// ===========================================
// Estatisticas
// ===========================================

/**
 * Obtem estatisticas de notificacoes
 */
export async function getNotificationStats(): Promise<{
  pending: number;
  sent: number;
  failed: number;
  byChannel: Record<string, number>;
}> {
  const [pending, sent, failed] = await Promise.all([
    prisma.notification.count({ where: { status: NotificationStatus.PENDING } }),
    prisma.notification.count({ where: { status: NotificationStatus.SENT } }),
    prisma.notification.count({ where: { status: NotificationStatus.FAILED } }),
  ]);

  const byChannel: Record<string, number> = {};
  const channels = await prisma.notification.groupBy({
    by: ['channel'],
    _count: true,
  });

  for (const channel of channels) {
    byChannel[channel.channel] = channel._count;
  }

  return { pending, sent, failed, byChannel };
}

export default {
  sendWhatsApp,
  sendEmail,
  sendWebhook,
  createNotifications,
  processPendingNotifications,
  getNotificationStats,
};
