// Utilidades de telefone BR + link wa.me.

/** Só os dígitos, sem DDI 55 (se vier com 12/13 dígitos começando em 55). */
function localDigits(phone: string): string {
  let d = phone.replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) {
    d = d.slice(2);
  }
  return d.slice(0, 11);
}

/** Máscara progressiva p/ input: (92) 99100-4063 (ou fixo (92) 3211-4063). */
export function maskPhone(value: string): string {
  const d = localDigits(value);
  if (!d) return '';
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  if (d.length <= 10) return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
}

/** Exibição padronizada; se não der p/ formatar, devolve o original. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const d = localDigits(phone);
  if (d.length === 10 || d.length === 11) return maskPhone(d);
  return phone;
}

/**
 * Monta link wa.me a partir de um telefone BR.
 * Tira não-dígitos; se vier sem DDI (10/11 dígitos), prefixa 55.
 */
export function waLink(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length <= 11) digits = `55${digits}`;
  return `https://wa.me/${digits}`;
}

/** Link wa.me com mensagem pré-preenchida. */
export function waLinkText(
  phone: string | null | undefined,
  text: string,
): string | null {
  const base = waLink(phone);
  if (!base) return null;
  return `${base}?text=${encodeURIComponent(text)}`;
}
