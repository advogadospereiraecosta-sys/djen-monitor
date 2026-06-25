# CHECKLIST OPERACIONAL DJEN MONITOR

## Verificacao Diaria (7h30)

### 1. Health Check
- [ ] Acessar `https://seu-djen-monitor.up.railway.app/health`
- [ ] Verificar status: `healthy`
- [ ] Confirmar conexao com banco de dados
- [ ] Verificar `activeLawyers` > 0
- [ ] Verificar `pendingNotifications` (deve ser > 0 se houver publicacoes)

### 2. Verificar Jobs Recentes
- [ ] Acessar `/api/jobs?limit=5`
- [ ] Confirmar que ultimo job e `COMPLETED`
- [ ] Verificar `publicationsFound` > 0
- [ ] Verificar `errorsCount` = 0

### 3. Revisar Publicacoes Criticas
- [ ] Acessar `/api/publications?urgency=CRITICAL&limit=10`
- [ ] Acessar `/api/publications?urgency=HIGH&limit=10`
- [ ] Verificar que advogados foram notificados
- [ ] Confirmar que prazos estao corretos

### 4. Revisar Notificacoes Pendentes
- [ ] Verificar se ha notificacoes com status `PENDING` > 30min
- [ ] Se sim, verificar logs do Railway para identificar falhas

---

## Revisao Semanal (Segunda-feira)

### 1. Analise de Estatisticas
- [ ] Total de publicacoes da semana
- [ ] Publicacoes por tipo (INTIMACAO, DESPACHO, etc.)
- [ ] Taxa de notificacoes enviadas vs falhadas
- [ ] OABs sem publicacoes (verificar se busca esta funcionando)

### 2. Verificar Integração Juris Agenda
- [ ] Confirmar que webhooks estao chegando
- [ ] Verificar se processos estao sendo vinculados
- [ ] Testar uma notificacao WhatsApp manualmente

### 3. Revisao de Logs
- [ ] Verificar logs do Railway para erros
- [ ] Identificar OABs com falhas constantes
- [ ] Verificar rate limits da API CNJ

---

## Revisao Mensal

### 1. Performance
- [ ] Tempo medio de execucao do daily check
- [ ] Quantidade de OABs processadas
- [ ] Uso de memoria/CPU no Railway

### 2. Base de Dados
- [ ] Verificar crescimento da tabela `publications`
- [ ] Limpar publicacoes antigas (> 90 dias) se necessario
- [ ] Verificar indexacao (queries lentas?)

### 3. Revisao de OABs
- [ ] Verificar OABs cadastradas
- [ ] Adicionar novas OABs do escritorio
- [ ] Remover OABs inativas
- [ ] Atualizar dados de advogados

### 4. Integração WhatsApp
- [ ] Testar Evolution API
- [ ] Verificar se mensagens estao sendo entregues
- [ ] Atualizar templates de mensagem se necessario

---

## Casos de Borda - Procedimentos

### CNJ API Indisponivel
1. Verificar status em https://comunicaapi.pje.jus.br
2. Se indisponivel, job sera marcado com erro
3. Proxima execucao ocorrera automaticamente
4. Publicacoes pendentes serao capturadas no proximo ciclo

### WhatsApp Nao Entrega
1. Verificar logs da Evolution API
2. Verificar status da mensagem no dashboard
3. Reenviar manualmente se necessario via `/api/notifications/retry/:id`

### OAB Sem Cadastro
1. Adicionar via interface do Juris Agenda
2. Ou inserir diretamente no banco
3. LawyerSearch sera criado automaticamente

### Publicacao Duplicada
1. Verificar `sourceRef` no banco
2. Se duplicata, ignorar (unique constraint)
3. Investigar se busca esta sendo feita 2x

### Prazo Calculado Incorretamente
1. Verificar `calculationSteps` no banco
2. Confirmar que feriados estao cadastrados
3. Verificar se advogado e Fazenda/Defensoria
4. Reportar bug se persistir

---

## Contatos de Emergência

| Servico | Status | Contato |
|---------|--------|---------|
| Railway | https://railway.app | suporte@railway.app |
| API CNJ | https://comunicaapi.pje.jus.br | Suporte CNJ |
| Evolution API | Dashboard | Configurar alertas |

---

## Links Importantes

- **DJEN Monitor API**: `https://seu-djen-monitor.up.railway.app`
- **Health Check**: `/health`
- **Juris Agenda**: `https://juris-agenda.vercel.app`
- **API CNJ**: `https://comunicaapi.pje.jus.br/api/v1/comunicacao`

---

## Referencias Legais

- CPC 219: Contagem em dias úteis
- CPC 224 §2: Início no primeiro dia útil seguinte
- CPC 231: Intimação eletrônica
- CPC 183: Prazo em dobro para Fazenda Pública
- CPC 186: Prazo em dobro para Defensoria
- Lei 11.419/2006 art. 5 §1: Ciência ficta 10 dias úteis
- Res CNJ 455/2022: DJEN
- Res CNJ 569/2024: DJEN atualizado

---

## FAQ Operacional

**P: Por que minha OAB nao esta retornando publicacoes?**
R: Verifique: (1) OAB cadastrada corretamente, (2) UF corresponde, (3) processo foi publicado no DJEN/CNJ

**P: Como adicionar novo advogado?**
R: INSERT na tabela `lawyers` + `lawyerSearches` via admin do banco ou webhook

**P: O que fazer se o job falhar?**
R: 1. Verificar logs no Railway, 2. Corrigir erro, 3. Executar manualmente via `/api/trigger/daily`

**P: Como testar sem afectar produção?**
R: Configure DATABASE_URL para um banco de teste separado

**P: Qual a melhor hora para buscar?**
R: 7h-8h (publicacoes do dia anterior) ou 14h-15h (publicacoes da manha)
