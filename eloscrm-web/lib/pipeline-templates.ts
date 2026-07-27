export type TemplateStage = { name: string; isWon?: boolean; isLost?: boolean };

export type PipelineTemplate = {
  id: string;
  name: string;
  description: string;
  stages: TemplateStage[];
};

export const PIPELINE_TEMPLATES: PipelineTemplate[] = [
  {
    id: "blank",
    name: "Em branco",
    description: "Começa com estágios genéricos (Novo, Ganho, Perdido) para você montar do zero.",
    stages: [],
  },
  {
    id: "vendas",
    name: "Funil de Vendas",
    description: "Do primeiro lead ao fechamento.",
    stages: [
      { name: "Novo lead" },
      { name: "Contato" },
      { name: "Qualificado" },
      { name: "Visita" },
      { name: "Proposta" },
      { name: "Fechado", isWon: true },
      { name: "Perdido", isLost: true },
    ],
  },
  {
    id: "locacao",
    name: "Locação",
    description: "Fluxo de aluguel de imóveis.",
    stages: [
      { name: "Interessado" },
      { name: "Visita" },
      { name: "Análise cadastral" },
      { name: "Contrato" },
      { name: "Ativo", isWon: true },
      { name: "Recusado", isLost: true },
    ],
  },
  {
    id: "captacao",
    name: "Captação de imóveis",
    description: "Prospecção e captação de imóveis para a carteira.",
    stages: [
      { name: "Prospecção" },
      { name: "Contato proprietário" },
      { name: "Visita ao imóvel" },
      { name: "Autorização" },
      { name: "Captado", isWon: true },
      { name: "Perdido", isLost: true },
    ],
  },
  {
    id: "pos-venda",
    name: "Pós-venda",
    description: "Relacionamento e indicações após o fechamento.",
    stages: [
      { name: "Entrega" },
      { name: "Acompanhamento" },
      { name: "Indicação" },
      { name: "Concluído", isWon: true },
    ],
  },
];
