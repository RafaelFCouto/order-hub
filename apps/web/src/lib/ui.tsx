import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type Tone = 'info' | 'success' | 'error';

interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
}

interface ConfirmOpts {
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface ConfirmState extends ConfirmOpts {
  resolve: (v: boolean) => void;
}

interface UiApi {
  toast: (message: string, tone?: Tone) => void;
  confirm: (opts: string | ConfirmOpts) => Promise<boolean>;
}

const UiContext = createContext<UiApi | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [conf, setConf] = useState<ConfirmState | null>(null);
  const idRef = useRef(0);

  const toast = useCallback((message: string, tone: Tone = 'info') => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const confirm = useCallback(
    (opts: string | ConfirmOpts) =>
      new Promise<boolean>((resolve) => {
        const o = typeof opts === 'string' ? { message: opts } : opts;
        setConf({ ...o, resolve });
      }),
    [],
  );

  const close = (v: boolean) => {
    conf?.resolve(v);
    setConf(null);
  };

  return (
    <UiContext.Provider value={{ toast, confirm }}>
      {children}

      <div className="toast-wrap">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast-${t.tone}`}
            onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}
          >
            {t.message}
          </div>
        ))}
      </div>

      {conf && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) close(false);
          }}
        >
          <div className="modal">
            <p className="confirm-msg">{conf.message}</p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => close(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={conf.danger ? 'btn-danger' : ''}
                onClick={() => close(true)}
              >
                {conf.confirmLabel ?? 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </UiContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useUi(): UiApi {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('useUi fora do UiProvider');
  return ctx;
}
