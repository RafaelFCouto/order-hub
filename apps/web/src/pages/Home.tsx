import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Me } from '../types';

export default function Home() {
  const { data: me, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/me'),
  });

  return (
    <div className="page">
      <h2>Início</h2>
      {isLoading ? (
        <p className="muted">Carregando...</p>
      ) : (
        <div className="card">
          <p>
            Olá, <strong>{me?.user.name}</strong>.
          </p>
          <p className="muted">
            Você gerencia {me?.stores.length ?? 0} loja(s).
          </p>
          <p className="muted">
            Próximas fases: clientes, produtos, pedidos.
          </p>
        </div>
      )}
    </div>
  );
}
