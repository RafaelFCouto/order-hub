/** Formata número (ou string decimal) em BRL. */
export function brl(value: number | string): string {
  const n = typeof value === 'string' ? Number(value) : value;
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}
