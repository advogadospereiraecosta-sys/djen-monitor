/**
 * DJEN Monitor - Database Seed
 * Escritório Pereira e Costa Advocacia
 *
 * OABs cadastradas:
 * - 19347/RN
 * - 21760/RN
 */

import { PrismaClient, LawyerStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Iniciando seed do DJEN Monitor - Pereira e Costa...");

  // ===========================================
  // Criar advogados do escritório Pereira e Costa
  // OABs reais: 19347/RN e 21760/RN
  // ===========================================
  console.log("Criando advogados...");

  const advogado1 = await prisma.lawyer.upsert({
    where: {
      oabNumber_oabState: {
        oabNumber: "19347",
        oabState: "RN",
      },
    },
    update: {},
    create: {
      oabNumber: "19347",
      oabState: "RN",
      name: "Dr. Pereira",
      email: "pereira@pereiraecosta.adv.br",
      phone: "+5584999990001",
      status: LawyerStatus.ACTIVE,
      doubleTerm: false,
      notes: "Sócio fundador - Pereira e Costa Advogados",
    },
  });

  const advogado2 = await prisma.lawyer.upsert({
    where: {
      oabNumber_oabState: {
        oabNumber: "21760",
        oabState: "RN",
      },
    },
    update: {},
    create: {
      oabNumber: "21760",
      oabState: "RN",
      name: "Dra. Costa",
      email: "costa@pereiraecosta.adv.br",
      phone: "+5584999990002",
      status: LawyerStatus.ACTIVE,
      doubleTerm: false,
      notes: "Sócia - Pereira e Costa Advogados",
    },
  });

  console.log("Advogados cadastrados:");
  console.log(`   - ${advogado1.name} (OAB ${advogado1.oabNumber}/${advogado1.oabState})`);
  console.log(`   - ${advogado2.name} (OAB ${advogado2.oabNumber}/${advogado2.oabState})`);

  // ===========================================
  // Criar buscas configuradas (diárias)
  // ===========================================
  console.log("\nConfigurando buscas diárias no DJEN...");

  await prisma.lawyerSearch.createMany({
    data: [
      {
        lawyerId: advogado1.id,
        query: advogado1.oabNumber,
        searchType: "OAB",
        frequency: "DAILY",
        active: true,
      },
      {
        lawyerId: advogado2.id,
        query: advogado2.oabNumber,
        searchType: "OAB",
        frequency: "DAILY",
        active: true,
      },
    ],
    skipDuplicates: true,
  });

  console.log("Buscas diárias configuradas para as duas OABs");

  // ===========================================
  // Criar feriados nacionais + estaduais RN
  // ===========================================
  console.log("\nCriando feriados nacionais e estaduais (RN)...");

  const feriados = [
    // 2025
    { date: "2025-01-01", name: "Confraternização Universal", type: "NACIONAL" },
    { date: "2025-03-03", name: "Carnaval", type: "NACIONAL" },
    { date: "2025-03-04", name: "Carnaval", type: "NACIONAL" },
    { date: "2025-04-18", name: "Sexta-feira Santa", type: "NACIONAL" },
    { date: "2025-04-21", name: "Tiradentes", type: "NACIONAL" },
    { date: "2025-05-01", name: "Dia do Trabalho", type: "NACIONAL" },
    { date: "2025-09-07", name: "Independência do Brasil", type: "NACIONAL" },
    { date: "2025-10-12", name: "Nossa Senhora Aparecida", type: "NACIONAL" },
    { date: "2025-11-02", name: "Finados", type: "NACIONAL" },
    { date: "2025-11-15", name: "Proclamação da República", type: "NACIONAL" },
    { date: "2025-12-25", name: "Natal", type: "NACIONAL" },
    // 2026
    { date: "2026-01-01", name: "Confraternização Universal", type: "NACIONAL" },
    { date: "2026-02-17", name: "Carnaval", type: "NACIONAL" },
    { date: "2026-02-18", name: "Carnaval", type: "NACIONAL" },
    { date: "2026-04-03", name: "Sexta-feira Santa", type: "NACIONAL" },
    { date: "2026-04-21", name: "Tiradentes", type: "NACIONAL" },
    { date: "2026-05-01", name: "Dia do Trabalho", type: "NACIONAL" },
    { date: "2026-09-07", name: "Independência do Brasil", type: "NACIONAL" },
    { date: "2026-10-12", name: "Nossa Senhora Aparecida", type: "NACIONAL" },
    { date: "2026-11-02", name: "Finados", type: "NACIONAL" },
    { date: "2026-11-15", name: "Proclamação da República", type: "NACIONAL" },
    { date: "2026-12-25", name: "Natal", type: "NACIONAL" },
    // Feriados estaduais RN
    { date: "2025-08-07", name: "Dia do Rio Grande do Norte", type: "ESTADUAL", state: "RN" },
    { date: "2026-08-07", name: "Dia do Rio Grande do Norte", type: "ESTADUAL", state: "RN" },
    // Feriados municipais Natal/RN (sede do escritório)
    { date: "2025-12-08", name: "Dia de Nossa Senhora da Conceição (Natal)", type: "MUNICIPAL", state: "RN" },
    { date: "2026-12-08", name: "Dia de Nossa Senhora da Conceição (Natal)", type: "MUNICIPAL", state: "RN" },
  ];

  for (const f of feriados) {
    await prisma.holiday.upsert({
      where: { date: new Date(f.date) },
      update: { name: f.name, state: f.state || null, type: f.type },
      create: {
        date: new Date(f.date),
        name: f.name,
        state: f.state || null,
        type: f.type,
      },
    });
  }

  console.log(`${feriados.length} feriados criados (nacionais + RN + Natal/RN)`);

  // ===========================================
  // Job de inicialização
  // ===========================================
  await prisma.cronJob.upsert({
    where: { name: "initial" },
    update: {},
    create: {
      name: "initial",
      status: "SUCCESS",
      lastRunAt: new Date(),
    },
  });

  console.log("\n✅ Seed concluído com sucesso!");
  console.log("");
  console.log("📋 Configuração:");
  console.log("   - Escritório: Pereira e Costa Advogados");
  console.log("   - UF: RN (Rio Grande do Norte)");
  console.log("   - OABs monitoradas: 19347/RN, 21760/RN");
  console.log("   - Busca diária: 7h (seg-sex)");
  console.log("   - Feriados: nacionais + RN + Natal/RN");
  console.log("");
  console.log("🚀 Próximos passos:");
  console.log("   1. Configure o arquivo .env");
  console.log("   2. Execute npm run dev para iniciar");
  console.log("   3. Acesse http://localhost:3001/health");
}

main()
  .catch((e) => {
    console.error("Erro ao executar seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });