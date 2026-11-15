import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Clock3, RotateCcw, WalletCards } from "lucide-react";
import { AccountSelect, EmptyState, ErrorMessage, Field, LoadingState, PageHeading } from "../components/PageStates";
import { api, getApiError } from "../lib/api";
import { getIdempotencyKey } from "../lib/idempotency";
import { formatDate, formatMoney } from "../lib/format";

const initialForm = { cuenta_id: "", monto: "", tasa_nominal_anual: "0", dias: "30" };
const termStateLabels = {
  activo: "Activo",
  finalizado: "Finalizado",
  cancelado: "Cancelado",
};

export default function FixedTermsPage() {
  const [accounts, setAccounts] = useState([]);
  const [terms, setTerms] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [simulation, setSimulation] = useState(null);
  const [result, setResult] = useState(null);
  const [stage, setStage] = useState("edit");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [cancelingId, setCancelingId] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestRef = useRef(null);
  const cancelRequestRef = useRef(null);
  const selectedAccount = accounts.find((account) => String(account.id) === form.cuenta_id);

  useEffect(() => {
    let active = true;
    api.get("/plazos-fijos")
      .then(async (termResult) => {
        if (!active) return;
        const errors = [];
        setTerms(termResult.data);
        // Consultar plazos puede liquidar vencimientos: leer cuentas después para mostrar el saldo acreditado.
        try {
          const accountResult = await api.get("/cuentas");
          if (!active) return;
          setAccounts(accountResult.data);
          if (accountResult.data[0]) {
            setForm((current) => ({ ...current, cuenta_id: String(accountResult.data[0].id) }));
          }
        } catch (requestError) {
          errors.push(`No pudimos cargar tus cuentas. ${getApiError(requestError)}`);
        }
        setError(errors.join(" "));
      })
      .catch((requestError) => {
        if (active) setError(`No pudimos cargar tus plazos fijos. ${getApiError(requestError)}`);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
    setSimulation(null);
    setResult(null);
    setStage("edit");
    setError("");
  }

  async function simulate(event) {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      const { data } = await api.post("/plazos-fijos/simular", {
        monto: form.monto,
        tasa_nominal_anual: form.tasa_nominal_anual,
        dias: Number(form.dias),
      });
      setSimulation(data);
      setStage("review");
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setWorking(false);
    }
  }

  async function createTerm() {
    const payload = {
      cuenta_id: Number(form.cuenta_id),
      monto: form.monto,
      tasa_nominal_anual: form.tasa_nominal_anual,
      dias: Number(form.dias),
    };
    setWorking(true);
    setError("");
    try {
      const key = getIdempotencyKey(requestRef, payload);
      const { data } = await api.post("/plazos-fijos", payload, {
        headers: { "Idempotency-Key": key },
      });
      setResult(data);
      setTerms((current) => [{
        ...data,
        interes_estimado: data.interes_estimado ?? data.interes,
      }, ...current]);
      if (data.saldo_resultante != null) {
        setAccounts((current) => current.map((account) =>
          account.id === data.cuenta_id ? { ...account, saldo: data.saldo_resultante } : account,
        ));
      }
      requestRef.current = null;
      setStage("success");
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setWorking(false);
    }
  }

  function resetForm() {
    setForm({ ...initialForm, cuenta_id: accounts[0] ? String(accounts[0].id) : "" });
    setSimulation(null);
    setResult(null);
    setStage("edit");
    setError("");
  }

  async function cancelTerm(term) {
    const payload = { plazo_fijo_id: term.id };
    setCancelingId(term.id);
    setError("");
    setNotice("");
    try {
      const key = getIdempotencyKey(cancelRequestRef, payload);
      const { data } = await api.post(`/plazos-fijos/${term.id}/cancelar`, {}, {
        headers: { "Idempotency-Key": key },
      });
      cancelRequestRef.current = null;
      setTerms((current) => current.map((item) =>
        item.id === term.id ? { ...item, estado: data.estado, monto_devuelto: data.monto_devuelto } : item,
      ));
      setAccounts((current) => current.map((account) =>
        account.id === data.cuenta_id ? { ...account, saldo: data.saldo_resultante } : account,
      ));
      setConfirmingId(null);
      setNotice(`Cancelación confirmada. Se devolvieron ${formatMoney(data.monto_devuelto)} a tu cuenta.`);

      const refreshWarnings = [];
      try {
        const termRefresh = await api.get("/plazos-fijos");
        setTerms(termRefresh.data);
      } catch {
        refreshWarnings.push("no pudimos actualizar el estado de tus plazos fijos");
      }
      try {
        // El listado puede liquidar otros vencimientos; actualizar el saldo después de esa liquidación.
        const accountRefresh = await api.get("/cuentas");
        setAccounts(accountRefresh.data);
      } catch {
        refreshWarnings.push("no pudimos actualizar tus saldos");
      }
      if (refreshWarnings.length) {
        setNotice((current) => `${current} La operación quedó confirmada, pero ${refreshWarnings.join(" y ")}; actualizá la página para volver a consultar.`);
      }
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setCancelingId(null);
    }
  }

  return (
    <div className="page-stack">
      <PageHeading eyebrow="HACÉ CRECER TUS AHORROS" title="Plazos fijos" description="Elegí un plazo y conocé cuánto vas a recibir al vencimiento." />
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {loading ? <LoadingState label="Cargando tus opciones..." /> : (
        <div className="two-column-layout">
          <section className="content-card operation-form-card">
            {stage === "success" ? (
              <div className="success-panel">
                <span className="result-mark"><Check size={25} aria-hidden="true" /></span>
                <span className="eyebrow">INVERSIÓN CONFIRMADA</span>
                <h2>Tu ahorro ya está en marcha.</h2>
                <p>Invertiste {formatMoney(result.monto_invertido)}. El total estimado al vencimiento es {formatMoney(result.monto_al_vencimiento)} el {formatDate(result.fecha_vencimiento)}.</p>
                <button type="button" className="button button-secondary" onClick={resetForm}><RotateCcw size={16} /> Crear otro plazo fijo</button>
              </div>
            ) : stage === "review" ? (
              <div className="form-stack">
                <button type="button" className="back-button" onClick={() => { setError(""); setStage("edit"); }} disabled={working}><ArrowLeft size={16} /> Volver y editar</button>
                <span className="eyebrow">SIMULACIÓN LISTA</span>
                <h2>Revisá tu inversión</h2>
                <p className="form-description">El cálculo final lo hizo NeoBank con la tasa y el plazo que elegiste.</p>
                <div className="simulation-highlight"><span>Vas a invertir</span><strong>{formatMoney(simulation.monto_invertido)}</strong></div>
                <dl className="detail-list">
                  <div><dt>Cuenta de origen</dt><dd>····{String(selectedAccount?.cbu || "").slice(-4)}</dd></div>
                  <div><dt>Plazo</dt><dd>{simulation.dias} días</dd></div>
                  <div><dt>Tasa nominal anual</dt><dd>{simulation.tasa_nominal_anual}%</dd></div>
                  <div><dt>Interés estimado</dt><dd>{formatMoney(simulation.interes)}</dd></div>
                  <div className="detail-total"><dt>Monto al vencimiento</dt><dd>{formatMoney(simulation.monto_al_vencimiento)}</dd></div>
                </dl>
                <div className="alert alert-info"><Clock3 size={17} /><span>Al consultar tus plazos después del vencimiento, se acredita el total calculado. También podés cancelar antes: se devuelve solo el capital, sin intereses ni penalidad.</span></div>
                <button type="button" className="button button-primary button-wide" onClick={createTerm} disabled={working}>
                  {working ? "Procesando..." : "Confirmar plazo fijo"} <ArrowRight size={17} />
                </button>
              </div>
            ) : accounts.length ? (
              <>
                <div className="section-heading">
                  <div><span className="eyebrow">AHORRÁ A TU MANERA</span><h2>Simulador de plazo fijo</h2></div>
                  <span className="section-icon"><WalletCards size={20} /></span>
                </div>
                <form className="form-stack" onSubmit={simulate}>
                  <AccountSelect accounts={accounts} value={form.cuenta_id} onChange={(value) => setForm((current) => ({ ...current, cuenta_id: value }))} />
                  <Field id="monto-plazo" name="monto" label="¿Cuánto querés invertir? (ARS)" type="number" inputMode="decimal" min="0.01" max="9999999999.99" step="0.01" placeholder="100000" value={form.monto} onChange={updateField} required />
                  <div className="form-row">
                    <Field id="dias-plazo" name="dias" label="Plazo (días)" type="number" min="1" max="365" step="1" value={form.dias} onChange={updateField} required />
                    <Field id="tasa-plazo" name="tasa_nominal_anual" label="Tasa anual (%)" type="number" min="0" max="200" step="0.01" value={form.tasa_nominal_anual} onChange={updateField} required />
                  </div>
                  <p className="form-footnote">La simulación es orientativa. Confirmá los datos y el importe antes de invertir.</p>
                  <button type="submit" className="button button-primary button-wide" disabled={working}>
                    {working ? "Calculando..." : "Simular rendimiento"} <ArrowRight size={17} />
                  </button>
                </form>
              </>
            ) : <EmptyState title="Necesitás una cuenta">No hay una cuenta disponible para constituir un plazo fijo.</EmptyState>}
          </section>

          <section className="content-card">
            <div className="section-heading"><div><span className="eyebrow">TUS INVERSIONES</span><h2>Tus plazos fijos</h2></div></div>
            {notice && <p className="profile-notice" role="status">{notice}</p>}
            {terms.length ? (
              <div className="history-list">
                {terms.map((term) => (
                  <article className="history-item term-history-item" key={term.id}>
                    <span className="history-icon"><WalletCards size={17} /></span>
                    <div className="history-main">
                      <strong>Capital: {formatMoney(term.monto_invertido)}</strong>
                      <span>{term.dias} días · vence {formatDate(term.fecha_vencimiento)}</span>
                      {term.estado === "cancelado" ? (
                        <div className="term-estimates">
                          <span>Capital devuelto <strong>{formatMoney(term.monto_invertido)}</strong></span>
                          <span>Sin intereses ni penalidad</span>
                        </div>
                      ) : (
                        <div className="term-estimates">
                          <span>{term.estado === "finalizado" ? "Beneficio acreditado" : "Beneficio estimado"} <strong>{formatMoney(term.interes_estimado)}</strong></span>
                          <span>{term.estado === "finalizado" ? "Total acreditado" : "Total estimado"} <strong>{formatMoney(term.monto_al_vencimiento)}</strong></span>
                        </div>
                      )}
                      {confirmingId === term.id && (
                        <div className="term-cancel-confirm" role="group" aria-label={`Confirmar cancelación de plazo fijo ${term.id}`}>
                          <p>Al cancelar, se devuelve el capital íntegro ({formatMoney(term.monto_invertido)}), sin intereses ni penalidad.</p>
                          <div>
                            <button type="button" className="button button-secondary" onClick={() => setConfirmingId(null)} disabled={cancelingId === term.id}>Volver</button>
                            <button type="button" className="button button-danger" onClick={() => cancelTerm(term)} disabled={cancelingId === term.id}>
                              {cancelingId === term.id ? "Cancelando..." : "Confirmar cancelación"}
                            </button>
                          </div>
                        </div>
                      )}
                      {term.estado === "activo" && confirmingId !== term.id && (
                        <button
                          type="button"
                          className="term-cancel-link"
                          onClick={() => { setConfirmingId(term.id); setError(""); setNotice(""); }}
                          disabled={cancelingId != null}
                        >
                          Cancelar plazo fijo
                        </button>
                      )}
                    </div>
                    <span className={`status-pill status-${term.estado}`}>{termStateLabels[term.estado] || term.estado}</span>
                  </article>
                ))}
              </div>
            ) : <EmptyState title="Todavía no tenés inversiones">Tus plazos fijos aparecerán acá cuando confirmes uno.</EmptyState>}
          </section>
        </div>
      )}
    </div>
  );
}
