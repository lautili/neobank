import {
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  CreditCard,
  Landmark,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  WalletCards,
} from "lucide-react";
import { NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./auth/useAuth";
import ProtectedRoute from "./components/ProtectedRoute";
import PublicOnlyRoute from "./components/PublicOnlyRoute";
import ActivityPage from "./pages/ActivityPage";
import AuthPage from "./pages/AuthPage";
import CardsPage from "./pages/CardsPage";
import FixedTermsPage from "./pages/FixedTermsPage";
import LoansPage from "./pages/LoansPage";
import OverviewPage from "./pages/OverviewPage";
import TransferPage from "./pages/TransferPage";

const navigation = [
  { to: "/", label: "Inicio", icon: LayoutDashboard, end: true },
  { to: "/movimientos", label: "Movimientos", icon: ReceiptText },
  { to: "/transferencias", label: "Transferencias", icon: ArrowLeftRight },
  { to: "/tarjetas", label: "Tarjetas", icon: CreditCard },
  { to: "/prestamos", label: "Préstamos", icon: Landmark },
  { to: "/plazos-fijos", label: "Plazos fijos", icon: WalletCards },
];

function DashboardLayout() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const currentPage = navigation.find(({ to, end }) =>
    end ? location.pathname === to : location.pathname.startsWith(to),
  );
  const firstName = user?.nombre?.split(" ")[0] || "Hola";

  function handleSignOut() {
    signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink className="brand" to="/" aria-label="NeoBank, ir al inicio">
          <span className="brand-mark">N</span>
          <span>neo<span className="brand-light">bank</span></span>
        </NavLink>
        <div className="sidebar-label">TU ESPACIO</div>
        <nav className="side-nav" aria-label="Navegación principal">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            >
              <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
              {label === "Transferencias" && <ArrowRight className="nav-trailing" size={15} aria-hidden="true" />}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-support">
            <span className="support-icon"><Banknote size={18} aria-hidden="true" /></span>
            <div><strong>Tu dinero, claro.</strong><span>Siempre a tu alcance.</span></div>
          </div>
          <button type="button" className="nav-link signout-link" onClick={handleSignOut}>
            <LogOut size={18} aria-hidden="true" />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <span className="topbar-kicker">NeoBank · Banca digital</span>
            <h2>{currentPage?.label || "Tu espacio"}</h2>
          </div>
          <div className="user-chip">
            <span className="user-avatar" aria-hidden="true">{firstName.slice(0, 1).toUpperCase()}</span>
            <span className="user-name">{firstName}</span>
          </div>
        </header>
        <main className="main-content">
          <Outlet />
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Navegación principal">
        {navigation.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} aria-label={label} className={({ isActive }) => isActive ? "mobile-nav-link active" : "mobile-nav-link"}>
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
        <button type="button" className="mobile-nav-link" onClick={handleSignOut} aria-label="Cerrar sesión">
          <LogOut size={20} aria-hidden="true" /><span>Salir</span>
        </button>
      </nav>
    </div>
  );
}

function NotFoundPage() {
  return (
    <section className="panel not-found">
      <span className="eyebrow">PÁGINA NO ENCONTRADA</span>
      <h1>Este camino no existe.</h1>
      <NavLink className="button button-primary" to="/">Volver al inicio <ArrowUpRight size={17} /></NavLink>
    </section>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/registro" element={<AuthPage />} />
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="movimientos" element={<ActivityPage />} />
          <Route path="transferencias" element={<TransferPage />} />
          <Route path="tarjetas" element={<CardsPage />} />
          <Route path="prestamos" element={<LoansPage />} />
          <Route path="plazos-fijos" element={<FixedTermsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
