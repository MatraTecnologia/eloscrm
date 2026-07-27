export type DefaultStage = { name: string; position: number; isWon?: boolean; isLost?: boolean };

export const DEFAULT_STAGES: DefaultStage[] = [
  { name: "Novo lead", position: 0 },
  { name: "Contato", position: 1 },
  { name: "Qualificado", position: 2 },
  { name: "Visita", position: 3 },
  { name: "Proposta", position: 4 },
  { name: "Fechado", position: 5, isWon: true },
  { name: "Perdido", position: 6, isLost: true },
];
