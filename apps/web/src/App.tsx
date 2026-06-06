import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import Layout from './components/Layout';
import Login from './pages/Login';
import Home from './pages/Home';
import Stores from './pages/Stores';
import Customers from './pages/Customers';
import Products from './pages/Products';
import Categories from './pages/Categories';
import Orders from './pages/Orders';
import OrderForm from './pages/OrderForm';

export default function App() {
  const { session, loading } = useAuth();

  if (loading) {
    return <div className="auth-screen muted">Carregando...</div>;
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/new" element={<OrderForm />} />
        <Route path="/orders/:id" element={<OrderForm />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/products" element={<Products />} />
        <Route path="/categories" element={<Categories />} />
        <Route path="/stores" element={<Stores />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
