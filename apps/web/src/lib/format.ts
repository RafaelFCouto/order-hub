/** Formata número (ou string decimal) em BRL. */
export function brl(value: number | string): string {
  const n = typeof value === 'string' ? Number(value) : value;
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

/** Máscara de centavos: "1650" -> "16,50"; "165000" -> "1.650,00". */
export function maskMoney(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const n = Number(digits) / 100;
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Lê o valor numérico (reais) de um campo mascarado. */
export function parseMoney(masked: string): number {
  const digits = masked.replace(/\D/g, '');
  return digits ? Number(digits) / 100 : 0;
}

/** Número (reais) -> string mascarada para semear inputs. */
export function moneyToMasked(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const num = typeof value === 'string' ? Number(value) : value;
  if (!num) return '';
  return maskMoney(String(Math.round(num * 100)));
}
