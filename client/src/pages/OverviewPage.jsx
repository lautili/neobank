import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Copy, CreditCard, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { ErrorMessage, EmptyState, LoadingState, PageHeading } from "../components/PageStates";
import { api, getApiError } from "../lib/api";
import { formatDate, formatMoney, getMovementLabel, isCreditMovement } from "../lib/format";

function MovementList({ movements }) {
  if (!movements.length) {
    return <EmptyState title="Todavía no hay movimientos">Cuando uses tu cuenta, vas a ver tus operaciones acá.</EmptyState>;
  }
  return (
    <div className="movement-list">
      {movements.map((movement) => {
        const credit = isCreditMovement(movement.tipo);
        return (
          <div className="movement-row" key={movement.id}>
            <span className={`movement-icon ${credit ? "positive" : "negative"}`}>
              {credit ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
            </span>
            <div className="movement-description">
              <strong>{getMovementLabel(movement.tipo)}</strong>
              <span>{formatDate(movement.created_at)}</span>
            </div>
            <strong className={`movement-amount ${credit ? "text-positive" : ""}`}>
              {credit ? "+" : "−"}{formatMoney(movement.monto)}
            </strong>
          </div>
        );
      })}
    </div>
  );
}

function AccountNumber({ label, value }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function copyNumber() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setError("");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("No se pudo copiar. Seleccioná el número para copiarlo.");
    }
  }

  return (
    <div className="account-number">
      <span>{label}</span>
      <strong>{value}</strong>
      <button type="button" className="icon-button" onClick={copyNumber} aria-label={`Copiar ${label}`}>
        <Copy size={15} aria-hidden="true" />
      </button>
      {copied && <span className="copy-feedback" role="status">Copiado</span>}
      {error && <span className="copy-error">{error}</span>}
    </div>
  );
}

export default function OverviewPage() {
  const [accounts, setAccounts] = useState([]);
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadDashboard() {
      setLoading(true);
      setError("");
      try {
        const { data: accountData } = await api.get("/cuentas");
        if (!active) return;
        setAccounts(accountData);
        if (accountData.length) {
          const { data: movementData } = await api.get(`/cuentas/${accountData[0].id}/movimientos`);
          if (active) setMovements(movementData.slice(0, 5));
        }
      } catch (requestError) {
        if (active) setError(getApiError(requestError));
      } finally {
        if (active) setLoading(false);
      }
    }
    loadDashboard();
    return () => { active = false; };
  }, []);

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="TU DINERO, EN UN VISTAZO"
        title="Hola, ¿qué hacemos hoy?"
        description="Tu día financiero empieza con claridad."
        action={<Link className="button button-primary" to="/transferencias"><Plus size={17} /> Nueva transferencia</Link>}
      />
      <ErrorMessage>{error}</ErrorMessage>
      {loading ? <LoadingState /> : accounts.length === 0 ? (
        <EmptyState title="No encontramos una cuenta">Contactá con soporte para revisar el estado de tu cuenta.</EmptyState>
      ) : (
        <>
          <section className="account-grid" aria-label="Tus cuentas">
            {accounts.map((account, index) => (
              <article className={`balance-card${index === 0 ? " balance-card-featured" : ""}`} key={account.id}>
                <div className="balance-card-top">
                  <span className="balance-label">SALDO DISPONIBLE</span>
                  <span className="balance-card-icon"><CreditCard size={19} aria-hidden="true" /></span>
                </div>
                <strong className="balance-value">{formatMoney(account.saldo)}</strong>
                <span className="balance-currency">{account.moneda} · Cuenta digital</span>
                <div className="account-numbers">
                  <AccountNumber label="CBU" value={account.cbu} />
                  <AccountNumber label="CVU" value={account.cvu} />
                </div>
              </article>
            ))}
            <article className="quick-card">
              <span className="quick-card-icon"><ArrowUpRight size={20} aria-hidden="true" /></span>
              <span className="eyebrow">A TU RITMO</span>
              <h3>Tu plata, tus decisiones.</h3>
              <p>Movela, ahorrala o planificá tu próximo paso desde un solo lugar.</p>
              <Link to="/plazos-fijos" className="text-link">Conocé tus opciones <ArrowRight size={16} /></Link>
            </article>
          </section>

          <section className="content-card">
            <div className="section-heading">
              <div><span className="eyebrow">ACTIVIDAD RECIENTE</span><h2>Últimos movimientos</h2></div>
              <Link className="text-link" to="/movimientos">Ver todos <ArrowRight size={16} /></Link>
            </div>
            <MovementList movements={movements} />
          </section>
        </>
      )}
    </div>
  );
}
