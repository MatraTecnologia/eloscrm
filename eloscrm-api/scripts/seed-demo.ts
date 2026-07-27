import "dotenv/config";
import { ActivityType, ClientSource, PropertyStatus } from "../src/generated/prisma/client.js";
import { prisma } from "../src/lib/prisma.js";

const ORGANIZATION_ID = "mogURJMqcX3V8zdsjujP5Gq89s0Dg45T";

const clientsData = [
  { name: "Carlos Eduardo Silva", phone: "(43) 99123-4567", email: "carlos.silva@gmail.com", source: ClientSource.SITE },
  { name: "Mariana Costa Ferreira", phone: "(43) 98234-5678", email: "mariana.ferreira@gmail.com", source: ClientSource.INSTAGRAM },
  { name: "Lucas Almeida Souza", phone: "(43) 99345-6789", email: "lucas.souza@outlook.com", source: ClientSource.INDICACAO },
  { name: "Ana Paula Pereira", phone: "(43) 98456-7890", email: "ana.pereira@gmail.com", source: ClientSource.WHATSAPP },
  { name: "Rafael Oliveira Santos", phone: "(43) 99567-8901", email: "rafael.santos@yahoo.com", source: ClientSource.OUTROS },
  { name: "Juliana Rodrigues Lima", phone: "(43) 98678-9012", email: "juliana.lima@gmail.com", source: ClientSource.SITE },
  { name: "Bruno Henrique Alves", phone: "(43) 99789-0123", email: "bruno.alves@hotmail.com", source: ClientSource.INSTAGRAM },
  { name: "Camila Fernandes Rocha", phone: "(43) 98890-1234", email: "camila.rocha@gmail.com", source: ClientSource.INDICACAO },
  { name: "Thiago Martins Barbosa", phone: "(43) 99901-2345", email: "thiago.barbosa@gmail.com", source: ClientSource.WHATSAPP },
  { name: "Beatriz Cardoso Nunes", phone: "(43) 98012-3456", email: "beatriz.nunes@outlook.com", source: ClientSource.OUTROS },
  { name: "Diego Ribeiro Gomes", phone: "(43) 99123-6547", email: "diego.gomes@gmail.com", source: ClientSource.SITE },
  { name: "Fernanda Castro Dias", phone: "(43) 98234-7658", email: "fernanda.dias@gmail.com", source: ClientSource.INSTAGRAM },
  { name: "Gabriel Teixeira Moura", phone: "(43) 99345-8769", email: "gabriel.moura@yahoo.com", source: ClientSource.INDICACAO },
  { name: "Larissa Monteiro Pinto", phone: "(43) 98456-9870", email: "larissa.pinto@gmail.com", source: ClientSource.WHATSAPP },
  { name: "Felipe Araújo Correia", phone: "(43) 99567-0981", email: "felipe.correia@hotmail.com", source: ClientSource.OUTROS },
  { name: "Patrícia Nogueira Vieira", phone: "(43) 98678-1092", email: "patricia.vieira@gmail.com", source: ClientSource.SITE },
  { name: "Rodrigo Batista Cavalcanti", phone: "(43) 99789-2103", email: "rodrigo.cavalcanti@gmail.com", source: ClientSource.INSTAGRAM },
  { name: "Vanessa Lopes Freitas", phone: "(43) 98890-3214", email: "vanessa.freitas@outlook.com", source: ClientSource.INDICACAO },
];

const propertiesData = [
  { title: "Apartamento Centro", type: "Apartamento", address: "Rua Sergipe, 450 - Centro", price: 320000, bedrooms: 2, area: 68, status: PropertyStatus.DISPONIVEL },
  { title: "Casa Alphaville", type: "Casa", address: "Alameda dos Ipês, 120 - Alphaville", price: 890000, bedrooms: 4, area: 210, status: PropertyStatus.DISPONIVEL },
  { title: "Cobertura Duplex Gleba Palhano", type: "Cobertura", address: "Av. Higienópolis, 900 - Gleba Palhano", price: 1450000, bedrooms: 4, area: 240, status: PropertyStatus.RESERVADO },
  { title: "Studio Universitário", type: "Studio", address: "Rua Piauí, 300 - Centro", price: 260000, bedrooms: 1, area: 35, status: PropertyStatus.DISPONIVEL },
  { title: "Apartamento Gleba Fazenda Palhano", type: "Apartamento", address: "Av. Madre Leônia Milito, 500 - Gleba Fazenda Palhano", price: 590000, bedrooms: 3, area: 105, status: PropertyStatus.DISPONIVEL },
  { title: "Casa Jardim Bandeirantes", type: "Casa", address: "Rua Belo Horizonte, 780 - Jardim Bandeirantes", price: 480000, bedrooms: 3, area: 150, status: PropertyStatus.VENDIDO },
  { title: "Cobertura Vale do Sol", type: "Cobertura", address: "Av. Tiradentes, 1200 - Vale do Sol", price: 1180000, bedrooms: 3, area: 190, status: PropertyStatus.DISPONIVEL },
  { title: "Studio Rua Paraná", type: "Studio", address: "Rua Paraná, 210 - Centro", price: 250000, bedrooms: 1, area: 38, status: PropertyStatus.INATIVO },
  { title: "Apartamento Santos Dumont", type: "Apartamento", address: "Rua Santos Dumont, 640 - Centro", price: 410000, bedrooms: 2, area: 82, status: PropertyStatus.RESERVADO },
  { title: "Casa Condomínio Waldemar Spranger", type: "Casa", address: "Av. Waldemar Spranger, 350 - Jardim Shangri-lá", price: 750000, bedrooms: 4, area: 220, status: PropertyStatus.DISPONIVEL },
  { title: "Cobertura Pernambuco", type: "Cobertura", address: "Rua Pernambuco, 88 - Centro", price: 1350000, bedrooms: 4, area: 235, status: PropertyStatus.DISPONIVEL },
  { title: "Apartamento Juscelino Kubitschek", type: "Apartamento", address: "Av. Juscelino Kubitschek, 1500 - Gleba Palhano", price: 680000, bedrooms: 3, area: 118, status: PropertyStatus.DISPONIVEL },
];

const activityTypes = [ActivityType.CALL, ActivityType.VISIT, ActivityType.PROPOSAL, ActivityType.NOTE];

const activityDescriptions: Record<ActivityType, (name: string) => string> = {
  [ActivityType.CALL]: (name) => `Ligação de acompanhamento com ${name}`,
  [ActivityType.VISIT]: (name) => `Visita agendada ao imóvel com ${name}`,
  [ActivityType.PROPOSAL]: (name) => `Envio de proposta comercial para ${name}`,
  [ActivityType.NOTE]: (name) => `Anotação sobre negociação com ${name}`,
};

const addDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

const run = async () => {
  const stages = await prisma.stage.findMany({
    where: { organizationId: ORGANIZATION_ID, pipeline: { isDefault: true } },
    orderBy: { position: "asc" },
  });
  if (stages.length === 0) throw new Error("Pipeline default não encontrado para a organização alvo");
  const pipelineId = stages[0].pipelineId;

  const clients = [];
  for (const c of clientsData) {
    const client = await prisma.client.create({
      data: { organizationId: ORGANIZATION_ID, name: c.name, phone: c.phone, email: c.email, source: c.source },
    });
    clients.push(client);
  }

  const properties = [];
  for (const p of propertiesData) {
    const property = await prisma.property.create({
      data: {
        organizationId: ORGANIZATION_ID,
        title: p.title,
        type: p.type,
        address: p.address,
        price: p.price,
        bedrooms: p.bedrooms,
        area: p.area,
        status: p.status,
        photos: [],
      },
    });
    properties.push(property);
  }

  const deals = [];
  for (let i = 0; i < 20; i++) {
    const client = clients[i % clients.length];
    const stage = stages[i % stages.length];
    const hasProperty = i % 2 === 0;
    const property = hasProperty ? properties[i % properties.length] : null;
    const value = property?.price ?? 200000 + ((i * 37000) % 700000);
    const deal = await prisma.deal.create({
      data: {
        organizationId: ORGANIZATION_ID,
        clientId: client.id,
        propertyId: property?.id,
        pipelineId,
        stageId: stage.id,
        title: `Negociação — ${client.name}`,
        value,
      },
    });
    deals.push(deal);
  }

  const today = new Date();
  for (let i = 0; i < 15; i++) {
    const client = clients[i % clients.length];
    const deal = i % 3 === 0 ? deals[i % deals.length] : null;
    const type = activityTypes[i % activityTypes.length];
    const dueAt = addDays(today, i % 11);
    const doneAt = i % 4 === 0 ? dueAt : null;
    await prisma.activity.create({
      data: {
        organizationId: ORGANIZATION_ID,
        clientId: client.id,
        dealId: deal?.id,
        type,
        description: activityDescriptions[type](client.name),
        dueAt,
        doneAt,
      },
    });
  }

  const [clientCount, propertyCount, dealCount, activityCount] = await Promise.all([
    prisma.client.count({ where: { organizationId: ORGANIZATION_ID } }),
    prisma.property.count({ where: { organizationId: ORGANIZATION_ID } }),
    prisma.deal.count({ where: { organizationId: ORGANIZATION_ID } }),
    prisma.activity.count({ where: { organizationId: ORGANIZATION_ID } }),
  ]);
  console.log("Contagens finais na org:", { clientCount, propertyCount, dealCount, activityCount });
};

run().finally(() => prisma.$disconnect());
