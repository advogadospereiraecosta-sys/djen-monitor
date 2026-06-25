# DJEN Monitor

Monitor automático do Diário de Justiça Eletrônico Nacional (DJEN) para o escritório Pereira e Costa Advogados.

## 📋 Sobre

Serviço standalone que:
- Busca publicações DJEN diariamente por OAB
- Classifica automaticamente por urgência (CPC 219/224/231/183/186)
- Calcula prazos fatais considerando dias úteis e ciência ficta
- Detecta prazo em dobro (Fazenda/Defensoria)
- Envia notificações via WhatsApp, Email ou Webhook
- Integra com o Juris Agenda via webhook

## 🏢 Escritório Monitorado

- **Escritório:** Pereira e Costa Advogados
- **UF:** RN (Rio Grande do Norte)
- **OABs:** 19347/RN, 21760/RN

## 🚀 Stack

- Node.js 20 + TypeScript
- Prisma 7 + PostgreSQL
- Express API
- node-cron para agendamento
- Pino logger estruturado

## 📦 Instalação Local

```bash
npm install
cp .env.example .env  # Configure as variáveis
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Acesse http://localhost:3001/health

## 🚂 Deploy no Railway

1. Conecte este repositório ao Railway
2. Adicione PostgreSQL (New > Database > PostgreSQL)
3. Configure as variáveis de ambiente (ver `.env.example`)
4. O `railway.toml` já tem os cron jobs configurados:
   - Busca DJEN: 7h, seg-sex
   - Notificações: a cada 4h
   - Feriados: anualmente

## 🔗 Integração com Juris Agenda

O DJEN Monitor envia webhooks para o Juris Agenda:

```
POST ${JURIS_AGENDA_WEBHOOK_URL}
Body: {
  event: "publication.created",
  data: {
    id, caseNumber, urgencyLevel, fatalDeadline, lawyerId, ...
  }
}
```

## 📜 Base Legal Implementada

| Dispositivo | Função |
|------------|--------|
| CPC 219 | Prazos em dias úteis |
| CPC 224 §2 | Início no primeiro dia útil seguinte |
| CPC 231 | Ciência ficta (10 dias úteis) |
| CPC 183/186 | Prazo em dobro (Fazenda/Defensoria) |
| Lei 11.419/2006 | Intimação eletrônica |
| Res CNJ 455/2022 | DJEN único |
| Res CNJ 569/2024 | Migração desde 16/09/2024 |

## 📖 Documentação

Veja a pasta `docs/` para checklists operacionais e detalhes.