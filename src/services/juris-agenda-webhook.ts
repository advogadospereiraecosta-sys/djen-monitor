/**
 * DJEN Monitor - Integracao Juris Agenda Webhook
 */

import axios from "axios";
import { prisma } from "../lib/prisma.js";
import { loggerWebhook } from "../lib/logger.js";

const WEBHOOK_URL = process.env.JURIS_AGENDA_WEBHOOK_URL || "";
const API_KEY = process.env.JURIS_AGENDA_API_KEY || "";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

interface PublicationData {
  id: string;
  cnjNumber: string | null;
  sourceId: string;
  source: string;
  publicationDate: Date;
  actType: string;
  actDescription: string;
  courtName: string;
  urgencyLevel: string;
  generatesDeadline: boolean;
  legalBasis: string | null;
  hasDoubleTerm: boolean;
  baseDeadlineDays: number | null;
  fatalDeadline: Date | null;
  fictionalDate: Date | null;
  warningDate: Date | null;
  lawyerId: string;
  raw: unknown;
}

export async function sendToJurisAgenda(publication: PublicationData): Promise<boolean> {
  if (!WEBHOOK_URL) {
    loggerWebhook.warn("Juris Agenda webhook URL nao configurado");
    return false;
  }

  const lawyer = await prisma.lawyer.findUnique({
    where: { id: publication.lawyerId },
    select: { id: true, name: true, oabNumber: true, oabState: true },
  });

  if (!lawyer) {
    throw new Error("Advogado nao encontrado");
  }

  const payload = {
    event: "publication.created",
    timestamp: new Date().toISOString(),
    data: {
      id: publication.id,
      cnjNumber: publication.cnjNumber,
      source: publication.source,
      sourceRef: publication.sourceId,
      publicationDate: publication.publicationDate.toISOString(),
      actType: publication.actType,
      actDescription: publication.actDescription,
      courtName: publication.courtName,
      urgencyLevel: publication.urgencyLevel,
      generatesDeadline: publication.generatesDeadline,
      legalBasis: publication.legalBasis,
      hasDoubleTerm: publication.hasDoubleTerm,
      baseDeadlineDays: publication.baseDeadlineDays,
      fatalDeadline: publication.fatalDeadline?.toISOString() || null,
      fictionalDate: publication.fictionalDate?.toISOString() || null,
      warningDate: publication.warningDate?.toISOString() || null,
      lawyer: { id: lawyer.id, name: lawyer.name, oabNumber: lawyer.oabNumber, oabState: lawyer.oabState },
      raw: publication.raw,
    },
  };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await axios.post(WEBHOOK_URL, payload, {
        headers: {
          "Content-Type": "application/json",
          "Authorization": API_KEY ? "Bearer " + API_KEY : "",
          "User-Agent": "DJEN-Monitor/1.0",
        },
        timeout: 30000,
      });

      if (response.status >= 200 && response.status < 300) {
        await prisma.publication.update({
          where: { id: publication.id },
          data: { syncedToJurisAgenda: true, syncedAt: new Date() },
        });

        await prisma.webhookEvent.create({
          data: {
            event: "publication.created",
            url: WEBHOOK_URL,
            payload: payload as any,
            status: "SUCCESS",
            statusCode: response.status,
            sentAt: new Date(),
          },
        });

        loggerWebhook.info({ publicationId: publication.id }, "Enviado para Juris Agenda");
        return true;
      }
    } catch (error) {
      lastError = error as Error;
      if (attempt < MAX_RETRIES - 1) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
      }
    }
  }

  throw lastError;
}

export async function syncPendingToJurisAgenda(): Promise<{ total: number; synced: number; failed: number }> {
  const pending = await prisma.publication.findMany({
    where: { syncedToJurisAgenda: false },
    take: 50,
    orderBy: { publicationDate: "desc" },
  });

  let synced = 0, failed = 0;

  for (const pub of pending) {
    try {
      await sendToJurisAgenda(pub as PublicationData);
      synced++;
    } catch {
      failed++;
    }
  }

  return { total: pending.length, synced, failed };
}

export default { sendToJurisAgenda, syncPendingToJurisAgenda };
