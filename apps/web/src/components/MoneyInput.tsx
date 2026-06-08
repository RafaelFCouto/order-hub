import { maskMoney } from '../lib/format';

interface Props {
  value: string; // string já mascarada (ex: "16,50")
  onChange: (masked: string) => void;
  placeholder?: string;
  required?: boolean;
}

/** Input de dinheiro com máscara de centavos (digita 1650 -> 16,50). */
export default function MoneyInput({
  value,
  onChange,
  placeholder,
  required,
}: Props) {
  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder={placeholder}
      value={value}
      required={required}
      onChange={(e) => onChange(maskMoney(e.target.value))}
    />
  );
}
