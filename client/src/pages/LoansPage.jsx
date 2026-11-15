import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Landmark, RotateCcw } from "lucide-react";
import { AccountSelect, EmptyState, ErrorMessage, Field, LoadingState, PageHeading } from "../components/PageStates";
import { api, getApiError } from "../lib/api";
import { getIdempotencyKey } from "../lib/idempotency";
import { formatDate, formatMoney } from "../lib/format";

const initialForm = { cuenta_id: "", monto: "", cuotas: "12", tasa_interes: "0" };

export default function LoansPage() {
  const [accounts, setAccounts] = useState([]);
  const [loans, setLoans] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [simulation, setSimulation] = useState(null);
  const [result, setResult] = useState(null);
  const [stage, setStage] = useState("edit");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef(null);
  const selectedAccount = accounts.find((account) => String(account.id) === form.cuenta_id);

  useEffect(() => {
    let active = true;
    Promise.allSettled([api.get("/cuentas"), api.get("/prestamos")])
      .then(([accountResult, loanResult]) => {
        if (!active) return;
        const errors = [];
        if (accountResult.status === "fulfilled") {
          setAccounts(accountResult.value.data);
          if (accountResult.value.data[0]) {
            setForm((current) => ({ ...current, cuenta_id: String(accountResult.value.data[0].id) }));
          }
        } else {
          errors.push(`No pudimos cargar tus cuentas. ${getApiError(accountResult.reason)}`);
        }
        if (loanResult.status === "fulfilled") setLoans(loanResult.value.data);
        else errors.push(`No pudimos cargar tus préstamos. ${getApiError(loanResult.reason)}`);
        setError(errors.join(" "));
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
      const { data } = await api.post("/prestamos/simular", {
        monto: form.monto,
        cuotas: Number(form.cuotas),
        tasa_interes: form.tasa_interes,
      });
      setSimulation(data);
      setStage("review");
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setWorking(false);
    }
  }

  async function createLoan() {
    const payload = {
      cuenta_id: Number(form.cuenta_id),
      monto: form.monto,
      cuotas: Number(form.cuotas),
      tasa_interes: form.tasa_interes,
    };
    setWorking(true);
    setError("");
    try {
      const key = getIdempotencyKey(requestRef, payload);
      const { data } = await api.post("/prestamos", payload, {
        headers: { "Idempotency-Key": key },
      });
      setResult(data);
      requestRef.current = null;
      setStage("success");
      try {
        const { data: loanData } = await api.get("/prestamos");
        setLoans(loanData);
      } catch (refreshError) {
        setError(`El préstamo se acreditó, pero no pudimos actualizar el historial. ${getApiError(refreshError)}`);
      }
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

  return (
    <div className="page-stack">
      <PageHeading eyebrow="PLANIFICÁ TU PRÓXIMO PASO" title="Préstamos" description="Simulá tus cuotas antes de solicitar el dinero." />
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {loading ? <LoadingState label="Cargando tus opciones..." /> : (
        <div className="two-column-layout">
          <section className="content-card operation-form-card">
            {stage === "success" ? (
              <div className="success-panel">
                <span className="result-mark"><Check size={25} aria-hidden="true" /></span>
                <span className="eyebrow">PRÉSTAMO ACREDITADO</span>
                <h2>Tu solicitud está lista.</h2>
                <p>Se acreditaron {formatMoney(result.monto_solicitado)} en tu cuenta. La cuota estimada es de {formatMoney(result.cuota)}.</p>
                <button type="button" className="button button-secondary" onClick={resetForm}><RotateCcw size={16} /> Simular otro préstamo</button>
              </div>
            ) : stage === "review" ? (
              <div className="form-stack">
                <button type="button" className="back-button" onClick={() => { setError(""); setStage("edit"); }} disabled={working}><ArrowLeft size={16} /> Volver y editar</button>
                <span className="eyebrow">SIMULACIÓN LISTA</span>
                <h2>Revisá tu préstamo</h2>
                <p className="form-description">Estos son los valores calculados por NeoBank antes de confirmar.</p>
                <div className="simulation-highlight"><span>Importe solicitado</span><strong>{formatMoney(simulation.monto_solicitado)}</strong></div>
                <dl className="detail-list">
                  <div><dt>Cuenta de acreditación</dt><dd>····{String(selectedAccount?.cbu || "").slice(-4)}</dd></div>
                  <div><dt>Cuotas</dt><dd>{simulation.cuotas} meses</dd></div>
                  <div><dt>Tasa anual</dt><dd>{simulation.tasa_interes}%</dd></div>
                  <div><dt>Valor de cada cuota</dt><dd>{formatMoney(simulation.cuota)}</dd></div>
                  <div><dt>Interés total</dt><dd>{formatMoney(simulation.interes)}</dd></div>
                  <div className="detail-total"><dt>Total a devolver</dt><dd>{formatMoney(simulation.total)}</dd></div>
                </dl>
                <div className="alert alert-info"><Landmark size={17} /><span>Al confirmar, el importe solicitado se acredita en la cuenta seleccionada.</span></div>
                <button type="button" className="button button-primary button-wide" onClick={createLoan} disabled={working}>
                  {working ? "Procesando..." : "Confirmar préstamo"} <ArrowRight size={17} />
                </button>
              </div>
            ) : accounts.length ? (
              <>
                <div className="section-heading">
                  <div><span className="eyebrow">CALCULÁ ANTES DE ELEGIR</span><h2>Simulador de préstamo</h2></div>
                  <span className="section-icon"><Landmark size={20} /></span>
                </div>
                <form className="form-stack" onSubmit={simulate}>
                  <AccountSelect accounts={accounts} value={form.cuenta_id} onChange={(value) => setForm((current) => ({ ...current, cuenta_id: value }))} />
                  <Field id="monto-prestamo" name="monto" label="¿Cuánto necesitás? (ARS)" type="number" inputMode="decimal" min="0.01" max="9999999999.99" step="0.01" placeholder="100000" value={form.monto} onChange={updateField} required />
                  <div className="form-row">
                    <Field id="cuotas" name="cuotas" label="Cantidad de cuotas" type="number" min="1" max="60" step="1" value={form.cuotas} onChange={updateField} required />
                    <Field id="tasa" name="tasa_interes" label="Tasa anual (%)" type="number" min="0" max="200" step="0.01" value={form.tasa_interes} onChange={updateField} required />
                  </div>
                  <p className="form-footnote">La tasa puede variar. Revisá siempre el resumen que te mostramos antes de confirmar.</p>
                  <button type="submit" className="button button-primary button-wide" disabled={working}>
                    {working ? "Calculando..." : "Simular préstamo"} <ArrowRight size={17} />
                  </button>
                </form>
              </>
            ) : <EmptyState title="Necesitás una cuenta">No hay una cuenta disponible para acreditar un préstamo.</EmptyState>}
          </section>

          <section className="content-card">
            <div className="section-heading"><div><span className="eyebrow">TUS SOLICITUDES</span><h2>Préstamos anteriores</h2></div></div>
            {loans.length ? (
              <div className="history-list">
                {loans.map((loan) => (
                  <article className="history-item" key={loan.id}>
                    <span className="history-icon"><Landmark size={17} /></span>
                    <div className="history-main"><strong>{formatMoney(loan.monto_solicitado)}</strong><span>{loan.cuotas} cuotas · {formatDate(loan.created_at)}</span></div>
                    <span className={`status-pill status-${loan.estado}`}>{loan.estado}</span>
                  </article>
                ))}
              </div>
            ) : <EmptyState title="Todavía no tenés préstamos">Si necesitás financiamiento, podés simularlo sin compromiso.</EmptyState>}
          </section>
        </div>
      )}
    </div>
  );
}
