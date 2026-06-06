// Monta link wa.me a partir de um telefone BR.
// Tira não-dígitos; se vier sem DDI (10/11 dígitos), prefixa 55.
export function waLink(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length <= 11) digits = `55${digits}`;
  return `https://wa.me/${digits}`;
}
