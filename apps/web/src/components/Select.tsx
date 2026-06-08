import { useEffect, useRef, useState } from 'react';

export interface Option {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchable?: boolean;
}

/** Dropdown custom (estilizável) — substitui o <select> nativo. */
export default function Select({
  value,
  options,
  onChange,
  placeholder = 'Selecione...',
  searchable = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  // limpa a busca ao fechar
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const term = query.trim().toLowerCase();
  const visible =
    searchable && term
      ? options.filter((o) => o.label.toLowerCase().includes(term))
      : options;

  return (
    <div className={`select ${open ? 'open' : ''}`} ref={ref}>
      <button
        type="button"
        className="select-btn"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={current ? '' : 'muted'}>
          {current?.label ?? placeholder}
        </span>
        <svg
          className="select-chevron"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="select-menu">
          {searchable && (
            <input
              className="select-search"
              placeholder="Buscar..."
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <ul role="listbox">
            {visible.length === 0 ? (
              <li className="select-empty muted">Nada encontrado</li>
            ) : (
              visible.map((o) => (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={o.value === value}
                  className={`select-option ${o.value === value ? 'sel' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  {o.label}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
