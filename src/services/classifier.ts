/**
 * DJEN Monitor - Classificador de Atos Processuais
 * Analisa публикаções e classifica urgencia, tipo de prazo e base legal
 */

import { UrgencyLevel } from '@prisma/client';
import { logger } from '../lib/logger.js';

// ===========================================
// Tipos
// ===========================================

export interface ClassificationResult {
  actType: string;
  urgencyLevel: UrgencyLevel;
  generatesDeadline: boolean;
  legalBasis: string | null;
  hasDoubleTerm: boolean;
  baseDeadlineDays: number | null;
  summary: string;
}

// ===========================================
// Mapeamento de Tipos de Ato
// ===========================================

enum ActType {
  CITACAO = 'CITACAO',
  INTIMACAO = 'INTIMACAO',
  SENTENCA = 'SENTENCA',
  DESPACHO = 'DESPACHO',
  DECISAO = 'DECISAO',
  ACORDAO = 'ACORDAO',
  PENHORA = 'PENHORA',
  ARQUIVAMENTO = 'ARQUIVAMENTO',
  NOTIFICACAO = 'NOTIFICACAO',
  AUDIENCIA = 'AUDIENCIA',
  BAIXA = 'BAIXA',
  CERTIDAO = 'CERTIDAO',
  OUTROS = 'OUTROS',
}

// Padrões regex para detectar tipo de ato
const ACT_TYPE_PATTERNS: { type: ActType; patterns: RegExp[] }[] = [
  {
    type: ActType.CITACAO,
    patterns: [
      /\bcitac[ãa]o\b/i,
      /\bcitado\b/i,
      /\bfoi\s+citad[oa]\b/i,
      /\bCITAÇÃO\b/i,
      /\bCITADO\b/i,
    ],
  },
  {
    type: ActType.INTIMACAO,
    patterns: [
      /\bintim[ãa]o\b/i,
      /\bintimad[oa]\b/i,
      /\bfoi\s+intimad[oa]\b/i,
      /\bINTIMAÇÃO\b/i,
      /\bintimar\b/i,
      /\bci[êe]ncia\s+(?:da\s+)?(?:parte)?\b/i,
    ],
  },
  {
    type: ActType.SENTENCA,
    patterns: [
      /\bsenten[çc]a\b/i,
      /\bproferiu\s+sentença\b/i,
      /\bjulgou\s+(?:o\s+)?(?:processo|pedido|claim)\b/i,
      /\bSENTENÇA\b/i,
      /\bJULGOU\b/i,
    ],
  },
  {
    type: ActType.DESPACHO,
    patterns: [
      /\bdespach[oo]\b/i,
      /\bdetermin[oa]\b/i,
      /\bdetermino\b/i,
      /\bexpeça(?:se)?\b/i,
      /\bDESPACHO\b/i,
    ],
  },
  {
    type: ActType.DECISAO,
    patterns: [
      /\bdecis[ãa]o\b/i,
      /\bdeferiu\b/i,
      /\bindeferiu\b/i,
      /\bconced[oe]\b/i,
      /\bneg[oa]\b/i,
      /\bDECISÃO\b/i,
    ],
  },
  {
    type: ActType.ACORDAO,
    patterns: [
      /\bacórdão\b/i,
      /\b acordão\b/i,
      /\bprocedente\b/i,
      /\bimprocedente\b/i,
      /\bACÓRDÃO\b/i,
      /\bnegou\s+(?:provimento|segue)\b/i,
      /\bdeu\s+provimento\b/i,
    ],
  },
  {
    type: ActType.PENHORA,
    patterns: [
      /\bpenhor[oa]\b/i,
      /\bbloqueio\b/i,
      /\bfaculdade\b/i,
      /\bpenhor(?:ar|ou)\b/i,
    ],
  },
  {
    type: ActType.ARQUIVAMENTO,
    patterns: [
      /\barquiv(?:ar|ou|amento)\b/i,
      /\btrancad[oa]\b/i,
      /\bexting(?:uir|uido|uindo)\b/i,
    ],
  },
  {
    type: ActType.NOTIFICACAO,
    patterns: [
      /\bnotifica(?:r|ção|do)\b/i,
      /\bcarta\s+(?:de\s+)?(?:notificação|notifica)\b/i,
    ],
  },
  {
    type: ActType.AUDIENCIA,
    patterns: [
      /\baud[ií]encia\b/i,
      /\bsessão\b/i,
      /\bconciliação\b/i,
      /\binstrução\b/i,
    ],
  },
];

// ===========================================
// Padrões para prazos em dobro
// ===========================================

const DOUBLE_TERM_PATTERNS = [
  /Fazenda\s+P[úu]blica/i,
  /fazenda\s+p[úu]blica/i,
  /Defensoria\s+P[úu]blica/i,
  /defensoria\s+p[úu]blica/i,
  /INSS\b/i,
  /Instituto\s+Nacional\s+do\s+Seguro\s+Social/i,
  /Uni[ãa]o\b/i,
  /Estado[s]?\b/i,
  /Munic[íi]pio[s]?\b/i,
  /Poder\s+P[úu]blico/i,
  /r[éê]u\s+(?:é\s+)?(?:Fazenda|Governo|Estado|União)/i,
  /partes\s+(?:são|haver[áa])\s+(?:Fazenda|Governo)/i,
  /autora?\s+(?:é\s+)?(?:Fazenda|Governo|Estado|União)/i,
];

// ===========================================
// Padrões para mero expediente
// ===========================================

const MERO_EXPEDIENTE_PATTERNS = [
  /mero\s+expediente/i,
  /ato\s+(?:de\s+)?(?:mera?)?\s+expediente/i,
  /publicação\s+(?:para\s+)?(?:fins?\s+de\s+)?(?:ciência|conhecimento)/i,
  /ciência\s+(?:de\s+)?(?:que\s+)?(?:o|os|a|as)\b/gi,
  /juntad[oa]\s+(?:de|do|da)\s+(?:documento|p|procuração|carta)/i,
  /certid[ãa]o\s+(?:de\s+)?(?:intimação|publiação)/i,
  /vista\s+(?:a|ao)\s+(?:advogado|parte|requerente)/i,
  /devolvido(?:s)?\s+(?:o|os|a|as)?\s*(?:autos?|processo)/i,
  /retorn(?:ar|ou|ando)\s+(?:os?\s+)?(?:autos?|processo)/i,
];

// ===========================================
// Padrões para base legal
// ===========================================

const LEGAL_BASIS_PATTERNS = [
  // CPCArtigos
  /CPC\s*§?\s*\d+[.,]?\s*\d*/i,
  /C[óo]digo\s+de\s+Processo\s+Civil\s*(?:art[º.]?)?\s*\d+/i,
  /art(?:igo)?\.?\s*\d+(?:\s*[.,]\s*\d+)?\s*(?:do\s+)?CPC/i,
  // Artigos especificos com padrao numerico
  /(?:art|artigo)\.?\s*(?:1\.)?\d{3}(?:\s*[.,]\s*\d+)?/gi,
  // Lei especial
  /Lei\s+\d+\.\d+\/\d+/i,
  /Lei\s+\d+\.\d+/i,
];

// ===========================================
// Mapeamento de urgencia por tipo de ato
// ===========================================

const URGENCY_BY_ACT_TYPE: Record<ActType, UrgencyLevel> = {
  [ActType.CITACAO]: UrgencyLevel.CRITICAL,
  [ActType.SENTENCA]: UrgencyLevel.HIGH,
  [ActType.INTIMACAO]: UrgencyLevel.HIGH,
  [ActType.DECISAO]: UrgencyLevel.HIGH,
  [ActType.ACORDAO]: UrgencyLevel.HIGH,
  [ActType.DESPACHO]: UrgencyLevel.MEDIUM,
  [ActType.AUDIENCIA]: UrgencyLevel.MEDIUM,
  [ActType.NOTIFICACAO]: UrgencyLevel.MEDIUM,
  [ActType.PENHORA]: UrgencyLevel.HIGH,
  [ActType.ARQUIVAMENTO]: UrgencyLevel.LOW,
  [ActType.BAIXA]: UrgencyLevel.INFO,
  [ActType.CERTIDAO]: UrgencyLevel.INFO,
  [ActType.OUTROS]: UrgencyLevel.MEDIUM,
};

// ===========================================
// Prazos base em dias uteis por tipo de ato
// ===========================================

const BASE_DEADLINE_DAYS: Partial<Record<ActType, number>> = {
  [ActType.CITACAO]: 15, // Prazo para contestacao
  [ActType.SENTENCA]: 15, // Prazo para recurso
  [ActType.INTIMACAO]: 15, // Geral
  [ActType.DECISAO]: 15, // Prazo para agravo
  [ActType.ACORDAO]: 15, // Prazo para embargos
  [ActType.DESPACHO]: 5, // 一般 prazos curtos
  [ActType.AUDIENCIA]: 0, // Sem prazo, apenas comparecimento
};

// ===========================================
// Funcoes de classificacao
// ===========================================

/**
 * Detecta o tipo de ato processual
 */
export function detectActType(text: string): ActType {
  const upperText = text.toUpperCase();

  for (const { type, patterns } of ACT_TYPE_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(upperText)) {
        return type;
      }
    }
  }

  return ActType.OUTROS;
}

/**
 * Verifica se o ato gera prazo em dobro
 */
export function hasDoubleTerm(text: string): boolean {
  const upperText = text.toUpperCase();
  return DOUBLE_TERM_PATTERNS.some(pattern => pattern.test(upperText));
}

/**
 * Verifica se e mero expediente (nao gera prazo)
 */
export function isMeroExpediente(text: string): boolean {
  const upperText = text.toUpperCase();
  return MERO_EXPEDIENTE_PATTERNS.some(pattern => pattern.test(upperText));
}

/**
 * Extrai base legal mencionada
 */
export function extractLegalBasis(text: string): string | null {
  for (const pattern of LEGAL_BASIS_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return match[0].trim();
    }
  }
  return null;
}

/**
 * Classifica urgencia baseada em palavras-chave
 */
export function classifyUrgencyByKeywords(text: string): UrgencyLevel {
  const upperText = text.toUpperCase();

  // Padroes de urgencia critica
  if (
    /\b(urgent|urgente|imediato|imediatamente|imediata)\b/i.test(upperText) ||
    /\b(flagrante|liminar|tutela\s+(?:de|antecipada))\b/i.test(upperText)
  ) {
    return UrgencyLevel.CRITICAL;
  }

  // Padroes de alta urgencia
  if (
    /\b(prazo\s+(?:em\s+)?dobro|prazo\s+(?:de\s+)?\d+\s+dias)\b/i.test(upperText) ||
    /\b(sentença|decisão\s+(?:interlocutória|terminal|cong))\b/i.test(upperText) ||
    /\b(acórdão|recurso|apelação|agravo)\b/i.test(upperText)
  ) {
    return UrgencyLevel.HIGH;
  }

  // Padroes de baixa urgencia
  if (
    /\b(arquivamento|baixa|extinção|trânsito)\b/i.test(upperText) ||
    /\b(certidão|carta|juntada\s+(?:de|do))\b/i.test(upperText)
  ) {
    return UrgencyLevel.LOW;
  }

  return UrgencyLevel.MEDIUM;
}

/**
 * Classifica publicação completa
 */
export function classifyPublication(
  description: string,
  actTypeFromApi?: string
): ClassificationResult {
  // Usa tipo da API se disponivel, senao detecta
  const detectedActType = actTypeFromApi
    ? detectActType(actTypeFromApi)
    : detectActType(description);

  // Verifica se e mero expediente
  const generatesDeadline = !isMeroExpediente(description);

  // Verifica prazo em dobro
  const hasDoubleTermFlag = hasDoubleTerm(description);

  // Extrai base legal
  const legalBasis = extractLegalBasis(description);

  // Classifica urgencia
  let urgencyLevel = URGENCY_BY_ACT_TYPE[detectedActType];

  // Se nao gera prazo, reduz urgencia
  if (!generatesDeadline) {
    urgencyLevel = UrgencyLevel.INFO;
  }

  // Sobrescreve com keywords
  const keywordUrgency = classifyUrgencyByKeywords(description);
  if (keywordUrgency > urgencyLevel) {
    urgencyLevel = keywordUrgency;
  }

  // Calcula prazo base
  let baseDeadlineDays: number | null = null;
  if (generatesDeadline) {
    baseDeadlineDays = BASE_DEADLINE_DAYS[detectedActType] || 15;

    // Dobra o prazo se aplicavel
    if (hasDoubleTermFlag) {
      baseDeadlineDays *= 2;
    }
  }

  // Gera sumario
  const summary = generateSummary(detectedActType, urgencyLevel, generatesDeadline, legalBasis);

  logger.debug({
    actType: detectedActType,
    urgencyLevel,
    generatesDeadline,
    hasDoubleTerm: hasDoubleTermFlag,
    legalBasis,
    baseDeadlineDays,
  }, 'Publication classified');

  return {
    actType: detectedActType,
    urgencyLevel,
    generatesDeadline,
    legalBasis,
    hasDoubleTerm: hasDoubleTermFlag,
    baseDeadlineDays,
    summary,
  };
}

/**
 * Gera sumario legivel da classificacao
 */
function generateSummary(
  actType: ActType,
  urgency: UrgencyLevel,
  generatesDeadline: boolean,
  legalBasis: string | null
): string {
  const parts: string[] = [];

  // Tipo do ato
  const actTypeLabels: Record<ActType, string> = {
    [ActType.CITACAO]: 'Citacao',
    [ActType.INTIMACAO]: 'Intimacao',
    [ActType.SENTENCA]: 'Sentenca',
    [ActType.DESPACHO]: 'Despacho',
    [ActType.DECISAO]: 'Decisao',
    [ActType.ACORDAO]: 'Acordao',
    [ActType.PENHORA]: 'Penhora',
    [ActType.ARQUIVAMENTO]: 'Arquivamento',
    [ActType.NOTIFICACAO]: 'Notificacao',
    [ActType.AUDIENCIA]: 'Audiencia',
    [ActType.BAIXA]: 'Baixa',
    [ActType.CERTIDAO]: 'Certidao',
    [ActType.OUTROS]: 'Outros',
  };
  parts.push(actTypeLabels[actType]);

  // Urgencia
  if (urgency === UrgencyLevel.CRITICAL) {
    parts.push('URGENTE');
  } else if (urgency === UrgencyLevel.HIGH) {
    parts.push('Alta prioridade');
  }

  // Prazo
  if (!generatesDeadline) {
    parts.push('Mero expediente');
  }

  // Base legal
  if (legalBasis) {
    parts.push(`Base: ${legalBasis}`);
  }

  return parts.join(' | ');
}

export default {
  classifyPublication,
  detectActType,
  hasDoubleTerm,
  isMeroExpediente,
  extractLegalBasis,
  classifyUrgencyByKeywords,
};
