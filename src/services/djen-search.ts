/**
 * DJEN Monitor - Servico de Busca DJEN
 * Orquestra busca, classificacao e salvamento de publicacoes
 */

import { prisma } from '../lib/prisma.js';
import { loggerSearch } from '../lib/logger.js';
import { cnjApi, CNJPublication } from '../api/cnj-comunica.js';
import { classifyPublication } from './classifier.js';
import { calculateDeadlines } from './deadline-calculator.js';
import { sendToJurisAgenda } from './juris-agenda-webhook.js';
import { createNotifications } from './notifications.js';

// ===========================================
// Tipos
// ===========================================

interface SearchStats {
  searched: number;
  newPublications: number;
  existingPublications: number;
  errors: number;
  classified: number;
}

interface LawyerWithSearches {
  id: string;
  oabNumber: string;
  oabState: string;
  name: string;
  doubleTerm: boolean;
  searches: {
    id: string;
    query: string;
    searchType: string;
    active: boolean;
  }[];
}

// ===========================================
// Funcao principal de busca
// ===========================================

/**
 * Executa busca diaria para todos os advogados ativos
 */
export async function runDailySearch(): Promise<SearchStats> {
  const stats: SearchStats = {
    searched: 0,
    newPublications: 0,
    existingPublications: 0,
    errors: 0,
    classified: 0,
  };

  loggerSearch.info('Iniciando busca diaria DJEN');

  // Busca advogados ativos com buscas configuradas
  const lawyers = await prisma.lawyer.findMany({
    where: { status: 'ACTIVE' },
    include: {
      searches: {
        where: { active: true },
      },
    },
  }) as LawyerWithSearches[];

  loggerSearch.info({ lawyerCount: lawyers.length }, 'Advogados encontrados para busca');

  // Processa cada advogado
  for (const lawyer of lawyers) {
    for (const search of lawyer.searches) {
      try {
        const result = await processSearch(lawyer, search);

        stats.searched++;
        stats.newPublications += result.newCount;
        stats.existingPublications += result.existingCount;
        stats.classified += result.classifiedCount;

        // Atualiza lastRunAt da busca
        await prisma.lawyerSearch.update({
          where: { id: search.id },
          data: { lastRunAt: new Date() },
        });

        loggerSearch.info({
          lawyer: lawyer.name,
          searchType: search.searchType,
          newPublications: result.newCount,
        }, 'Busca concluida para advogado');
      } catch (error) {
        stats.errors++;
        loggerSearch.error({
          lawyer: lawyer.name,
          searchType: search.searchType,
          error: error instanceof Error ? error.message : String(error),
        }, 'Erro ao processar busca');
      }
    }
  }

  loggerSearch.info(stats, 'Busca diaria DJEN concluida');

  return stats;
}

/**
 * Processa uma busca especifica
 */
export async function processSearch(
  lawyer: LawyerWithSearches,
  search: { id: string; query: string; searchType: string }
): Promise<{ newCount: number; existingCount: number; classifiedCount: number }> {
  let newCount = 0;
  let existingCount = 0;
  let classifiedCount = 0;

  // Define periodo de busca (ultimos 7 dias por padrao)
  const dateTo = new Date();
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - 7);

  // Executa busca na API CNJ
  let publications: CNJPublication[];

  if (search.searchType === 'OAB') {
    const result = await cnjApi.searchByOAB(
      search.query,
      lawyer.oabState,
      dateFrom,
      dateTo
    );
    publications = result.publicacoes || [];
  } else if (search.searchType === 'CNJ') {
    const pub = await cnjApi.searchByCNJ(search.query);
    publications = pub ? [pub] : [];
  } else {
    // CPF
    const result = await cnjApi.searchByCPF(search.query, dateFrom, dateTo);
    publications = result.publicacoes || [];
  }

  loggerSearch.debug({
    searchType: search.searchType,
    query: search.query,
    found: publications.length,
  }, 'Publicacoes encontradas na API');

  // Processa cada publicacao
  for (const pub of publications) {
    try {
      const existingPub = await prisma.publication.findFirst({
        where: {
          source: 'DJEN',
          sourceRef: pub.id,
        },
      });

      if (existingPub) {
        existingCount++;
        continue;
      }

      // Verifica duplicata por numero de processo
      if (pub.numeroProcesso) {
        const duplicateByCNJ = await prisma.publication.findFirst({
          where: {
            source: 'DJEN',
            cnjNumber: pub.numeroProcesso,
            publicationDate: new Date(pub.dataPublicacao || pub.dataDisponibilizacao || new Date()),
          },
        });

        if (duplicateByCNJ) {
          existingCount++;
          continue;
        }
      }

      // Classifica a publicacao
      const classification = classifyPublication(
        pub.descricao || pub.conteudo || pub.titulo || '',
        pub.tipo
      );

      // Calcula prazos
      const publicationDate = new Date(pub.dataPublicacao || pub.dataDisponibilizacao || new Date());
      const deadlines = await calculateDeadlines(
        publicationDate,
        classification.baseDeadlineDays || 15,
        classification.hasDoubleTerm || lawyer.doubleTerm,
        lawyer.oabState
      );

      // Salva publicacao
      const savedPublication = await prisma.publication.create({
        data: {
          cnjNumber: pub.numeroProcesso || null,
          sourceId: pub.id,
          source: 'DJEN',
          sourceRef: pub.id,
          publicationDate,
          consultationDate: new Date(),
          actType: classification.actType,
          actDescription: pub.descricao || pub.conteudo || pub.titulo || '',
          courtName: pub.orgaoJulgador || '',
          urgencyLevel: classification.urgencyLevel,
          generatesDeadline: classification.generatesDeadline,
          legalBasis: classification.legalBasis,
          hasDoubleTerm: classification.hasDoubleTerm || lawyer.doubleTerm,
          baseDeadlineDays: classification.baseDeadlineDays,
          fatalDeadline: deadlines.fatalDeadline,
          fictionalDate: deadlines.fictionalDate,
          warningDate: deadlines.warningDate,
          raw: pub as never,
          lawyerId: lawyer.id,
        },
      });

      newCount++;
      classifiedCount++;

      loggerSearch.info({
        publicationId: savedPublication.id,
        cnjNumber: pub.numeroProcesso,
        actType: classification.actType,
        urgencyLevel: classification.urgencyLevel,
        fatalDeadline: deadlines.fatalDeadline?.toISOString(),
      }, 'Nova publicacao salva');

      // Cria notificacoes
      await createNotifications(savedPublication.id);

      // Envia para Juris Agenda
      try {
        await sendToJurisAgenda(savedPublication);
      } catch (error) {
        loggerSearch.error({
          publicationId: savedPublication.id,
          error: error instanceof Error ? error.message : String(error),
        }, 'Erro ao enviar para Juris Agenda');
      }

    } catch (error) {
      loggerSearch.error({
        publicationId: pub.id,
        error: error instanceof Error ? error.message : String(error),
      }, 'Erro ao processar publicacao');
    }
  }

  return { newCount, existingCount, classifiedCount };
}

/**
 * Busca publicacoes pendentes de sincronizacao com Juris Agenda
 */
export async function syncPendingPublications(): Promise<number> {
  const pending = await prisma.publication.findMany({
    where: {
      syncedToJurisAgenda: false,
    },
    take: 100,
  });

  let synced = 0;

  for (const pub of pending) {
    try {
      await sendToJurisAgenda(pub);
      synced++;
    } catch (error) {
      loggerSearch.error({
        publicationId: pub.id,
        error: error instanceof Error ? error.message : String(error),
      }, 'Erro ao sincronizar publicacao');
    }
  }

  return synced;
}

/**
 * Busca publicacoes por advogado
 */
export async function getPublicationsByLawyer(
  lawyerId: string,
  options: {
    limit?: number;
    offset?: number;
    urgencyLevel?: string;
    dateFrom?: Date;
    dateTo?: Date;
  } = {}
) {
  const { limit = 50, offset = 0, urgencyLevel, dateFrom, dateTo } = options;

  const where: Record<string, unknown> = { lawyerId };

  if (urgencyLevel) {
    where.urgencyLevel = urgencyLevel;
  }

  if (dateFrom || dateTo) {
    where.publicationDate = {};
    if (dateFrom) (where.publicationDate as Record<string, Date>).gte = dateFrom;
    if (dateTo) (where.publicationDate as Record<string, Date>).lte = dateTo;
  }

  const [publications, total] = await Promise.all([
    prisma.publication.findMany({
      where,
      include: {
        lawyer: {
          select: {
            id: true,
            name: true,
            oabNumber: true,
            oabState: true,
          },
        },
      },
      orderBy: { publicationDate: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.publication.count({ where }),
  ]);

  return { publications, total };
}

export default {
  runDailySearch,
  processSearch,
  syncPendingPublications,
  getPublicationsByLawyer,
};
