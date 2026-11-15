import { useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, Check } from "lucide-react";
import { AccountSelect, EmptyState, ErrorMessage, Field, LoadingState, PageHeading } from "../components/PageStates";
import { api, getApiError } from "../lib/api";
import { formatDate, formatMoney, getMovementLabel, isCreditMovement } from "../lib/format";
import { getIdempotencyKey } from "../lib/idempotency";

export default function ActivityPage() {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [movements, setMovements] = useState([]);
  const [type, setType] = useState("ingreso");
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState("edit");
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadedAccountId, setLoadedAccountId] = useState("");
  const [error, setError] = useState("");
  const requestRef = useRef(null);
  const loading = loadingAccounts || Boolean(accountId && loadedAccountId !== accountId);

  useEffect(() => {
    let active = true;
    api.get("/cuentas")
      .then(({ data }) => {
        if (!active) return;
        setAccounts(data);
        setAccountId(data[0] ? String(data[0].id) : "");
      })
      .catch((requestError) => { if (active) setError(getApiError(requestError)); })
      .finally(() => { if (active) setLoadingAccounts(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!accountId) {
      return undefined;
    }
    let active = true;
    api.get(`/cuentas/${accountId}/movimientos`)
      .then(({ data }) => {
        if (!active) return;
        setMovements(data);
        setLoadedAccountId(accountId);
      })
      .catch((requestError) => {
        if (!active) return;
        setError(getApiError(requestError));
        setLoadedAccountId(accountId);
      });
    return () => { active = false; };
  }, [accountId]);

  function prepareMovement(event) {
    event.preventDefault();
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || Number(amount) > 9999999999.99) {
      setError("Ingresá un importe válido, de hasta $9.999.999.999,99.");
      return;
    }
    const account = accounts.find((item) => String(item.id) === accountId);
    if (type === "extraccion" && account && Number(amount) > Number(account.saldo)) {
      setError("El importe supera el saldo disponible en esta cuenta.");
      return;
    }
    setError("");
    setStage("confirm");
  }

  async function confirmMovement() {
    const payload = { tipo: type, monto: amount };
    setSubmitting(true);
    setError("");
    try {
      const key = getIdempotencyKey(requestRef, { cuenta_id: Number(accountId), ...payload });
      const { data } = await api.post(`/cuentas/${accountId}/movimientos`, payload, {
        headers: { "Idempotency-Key": key },
      });
      requestRef.current = null;
      setResult(data);
      setStage("success");
      try {
        const [{ data: accountData }, { data: movementData }] = await Promise.all([
          api.get("/cuentas"),
          api.get(`/cuentas/${accountId}/movimientos`),
        ]);
        setAccounts(accountData);
        setMovements(movementData);
      } catch (refreshError) {
        setError(`El movimiento se realizó, pero no pudimos actualizar el resumen. ${getApiError(refreshError)}`);
      }
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  function cancelMovement() {
    setError("");
    setStage("edit");
  }

  return (
    <div className="page-stack">
      <PageHeading eyebrow="EL DETALLE DE TU CUENTA" title="Movimientos" description="Revisá la actividad de tu cuenta, siempre al día." />
      <ErrorMessage>{error}</ErrorMessage>
      {accounts.length > 1 && <AccountSelect accounts={accounts} value={accountId} onChange={(value) => { setAccountId(value); setStage("edit"); setError(""); }} />}
      {accounts.length > 0 && (
        <section className="content-card operation-form-card">
          {stage === "success" ? (
            <div className="success-panel">
              <span className="result-mark"><Check size={23} aria-hidden="true" /></span>
              <span className="eyebrow">MOVIMIENTO REALIZADO</span>
              <h2>{result.tipo === "ingreso" ? "Ingreso acreditado." : "Extracción realizada."}</h2>
              <p>{result.tipo === "ingreso" ? "Se acreditaron" : "Se debitaron"} {formatMoney(result.monto)}. Tu saldo quedó en {formatMoney(result.saldo_resultante)}.</p>
              <button type="button" className="button button-secondary" onClick={() => { setAmount(""); setResult(null); setStage("edit"); setError(""); }}>
                Registrar otro movimiento <ArrowRight size={16} />
              </button>
            </div>
          ) : stage === "confirm" ? (
            <div className="movement-confirmation">
              <button type="button" className="back-button" onClick={cancelMovement} disabled={submitting}><ArrowLeft size={16} /> Volver y editar</button>
              <span className="eyebrow">MOVIMIENTO SIMULADO</span>
              <h2>Confirmá la operación</h2>
              <p>Esta acción modifica el saldo de tu cuenta de demostración.</p>
              <div className="transfer-summary">
                <span className={`movement-icon ${type === "ingreso" ? "positive" : "negative"}`}>{type === "ingreso" ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}</span>
                <div><span>{type === "ingreso" ? "Ingreso a tu cuenta" : "Extracción de tu cuenta"}</span><strong>{formatMoney(amount)}</strong></div>
              </div>
              <button type="button" className="button button-primary button-wide" onClick={confirmMovement} disabled={submitting}>
                {submitting ? "Procesando..." : "Confirmar movimiento"} <ArrowRight size={17} />
              </button>
            </div>
          ) : (
            <>
              <div className="section-heading">
                <div><span className="eyebrow">MODO DEMOSTRACIÓN</span><h2>Simular un movimiento</h2></div>
              </div>
              <form className="form-stack" onSubmit={prepareMovement}>
                <div className="field">
                  <label htmlFor="tipo-movimiento">Tipo de movimiento</label>
                  <select id="tipo-movimiento" value={type} onChange={(event) => setType(event.target.value)}>
                    <option value="ingreso">Ingreso simulado</option>
                    <option value="extraccion">Extracción simulada</option>
                  </select>
                </div>
                <Field id="monto-movimiento" label="Importe en ARS" type="text" inputMode="decimal" pattern="\d+(\.\d{1,2})?" placeholder="0,00" value={amount} onChange={(event) => setAmount(event.target.value)} required />
                <p className="form-footnote">Los ingresos y extracciones son simulados y se reflejan en el saldo de esta cuenta.</p>
                <button type="submit" className="button button-primary">Revisar movimiento <ArrowRight size={17} /></button>
              </form>
            </>
          )}
        </section>
      )}
      <section className="content-card">
        <div className="section-heading">
          <div><span className="eyebrow">ÚLTIMOS 100</span><h2>Tu actividad</h2></div>
          <span className="soft-badge">{movements.length} movimientos</span>
        </div>
        {loading ? <LoadingState label="Buscando movimientos..." /> : movements.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>OPERACIÓN</th><th>FECHA</th><th className="align-right">IMPORTE</th><th className="align-right">SALDO</th></tr></thead>
              <tbody>
                {movements.map((movement) => {
                  const credit = isCreditMovement(movement.tipo);
                  return (
                    <tr key={movement.id}>
                      <td><span className={`table-dot ${credit ? "positive" : ""}`} />{getMovementLabel(movement.tipo)}</td>
                      <td>{formatDate(movement.created_at)}</td>
                      <td className={`align-right ${credit ? "text-positive" : ""}`}>{credit ? "+" : "−"}{formatMoney(movement.monto)}</td>
                      <td className="align-right">{formatMoney(movement.saldo_resultante)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="Todavía no hay movimientos">Las operaciones de tu cuenta van a aparecer acá.</EmptyState>}
      </section>
    </div>
  );
}
