import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { api } from '../lib/api';
import type { Me } from '../types';

export default function Layout() {
  const { signOut } = useAuth();
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/me'),
  });

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">OrderHub</span>
        <div className="topbar-right">
          <span className="muted">{me?.user.name}</span>
          <button className="link" onClick={() => signOut()}>
            Sair
          </button>
        </div>
      </header>

      <main className="content">
        <Outlet />
      </main>

      <nav className="bottomnav">
        <NavLink to="/" end>
          Início
        </NavLink>
        <NavLink to="/customers">Clientes</NavLink>
        <NavLink to="/products">Produtos</NavLink>
        <NavLink to="/stores">Lojas</NavLink>
      </nav>
    </div>
  );
}
