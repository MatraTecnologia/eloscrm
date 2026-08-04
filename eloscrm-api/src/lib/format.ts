const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

const STEP = 1024;

/**
 * Tamanho de arquivo legível, em pt-BR.
 *
 * Base 1024 com sufixo curto — é o que o sistema operacional mostra, e o número aparece em texto
 * que o corretor lê ("arquivo de 29,4 MB"), não em relatório técnico.
 *
 * Bytes saem inteiros (não existe meio byte); daí para cima, uma casa decimal, que é o suficiente
 * para distinguir 29,4 de 29,9 MB sem virar ruído. O arredondamento é conferido **depois** de
 * escolher a unidade: 1048000 bytes arredondaria para "1024,0 KB", que ninguém escreve — vira 1 MB.
 *
 * Entrada inválida (nulo, NaN, infinito) devolve travessão em vez de "NaN MB", porque esse valor
 * costuma vir de campo opcional do provedor e o texto vai direto para a tela.
 */
export const formatBytes = (bytes: number | null | undefined): string => {
  if (bytes == null || !Number.isFinite(bytes)) return "—";

  const negative = bytes < 0;
  let value = Math.abs(bytes);
  let unit = 0;

  while (value >= STEP && unit < UNITS.length - 1) {
    value /= STEP;
    unit++;
  }

  const digits = unit === 0 ? 0 : 1;
  // o arredondamento pode empurrar para a unidade seguinte (1023,97 KB -> 1024,0 KB -> 1 MB)
  if (Number(value.toFixed(digits)) >= STEP && unit < UNITS.length - 1) {
    value /= STEP;
    unit++;
  }

  const formatted = value.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: unit === 0 ? 0 : 1,
  });

  return `${negative ? "-" : ""}${formatted} ${UNITS[unit]}`;
};
