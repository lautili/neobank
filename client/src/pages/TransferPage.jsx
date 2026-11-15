import { useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, Check, CircleHelp, ShieldCheck } from "lucide-react";
import { AccountSelect, EmptyState, ErrorMessage, Field, LoadingState, PageHeading } from "../components/PageStates";
import { api, getApiError } from "../lib/api";
import { formatDate, formatMoney } from "../lib/format";
import { getIdempotencyKey } from "../lib/idempotency";

const initialForm = { cuenta_origen_id: "", destino: "", monto: "", descripcion: "" };
const ALIAS_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{5,29}$/;

export default function TransferPage() {
  const [form, setForm] = useState(initialForm);
  const [accounts, setAccounts] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [stage, setStage] = useState("edit");
  const [result, setResult] = useState(null);
  const requestRef = useRef(null);

  useEffect(() => {
    let active = true;
    Promise.allSettled([api.get("/cuentas"), api.get("/transferencias")])
      .then(([accountResult, transferResult]) => {
        if (!active) return;
        const errors = [];
        if (accountResult.status === "fulfilled") {
          setAccounts(accountResult.value.data);
          if (accountResult.value.data[0]) {
            setForm((current) => ({ ...current, cuenta_origen_id: String(accountResult.value.data[0].id) }));
          }
        } else {
          errors.push(`No pudimos cargar tus cuentas. ${getApiError(accountResult.reason)}`);
        }
        if (transferResult.status === "fulfilled") setTransfers(transferResult.value.data);
        else errors.push(`No pudimos cargar tus transferencias recientes. ${getApiError(transferResult.reason)}`);
        setError(errors.join(" "));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
    setError("");
  }

  function prepareReview(event) {
    event.preventDefault();
    const destination = form.destino.trim();
    if (!/^\d{22}$/.test(destination) && !ALIAS_PATTERN.test(destination)) {
      setError("Ingresá un alias bancario válido (6 a 30 caracteres, sin espacios) o un CBU/CVU de 22 números.");
      return;
    }
    if (!/^\d+(\.\d{1,2})?$/.test(form.monto) || Number(form.monto) <= 0 || Number(form.monto) > 9999999999.99) {
      setError("Ingresá un importe válido, de hasta $9.999.999.999,99.");
      return;
    }
    setError("");
    setStage("confirm");
  }

  async function confirmTransfer() {
    const payload = {
      cuenta_origen_id: Number(form.cuenta_origen_id),
      destino: form.destino.trim(),
      monto: form.monto,
      descripcion: form.descripcion.trim() || null,
    };
    setSending(true);
    setError("");
    try {
      const key = getIdempotencyKey(requestRef, payload);
      const { data } = await api.post("/transferencias", payload, {
        headers: { "Idempotency-Key": key },
      });
      setResult(data);
      requestRef.current = null;
      setStage("success");
      try {
        const { data: transferData } = await api.get("/transferencias");
        setTransfers(transferData);
      } catch (refreshError) {
        setError(`La transferencia se realizó, pero no pudimos actualizar el historial. ${getApiError(refreshError)}`);
      }
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setSending(false);
    }
  }

  function startAnother() {
    setForm({ ...initialForm, cuenta_origen_id: accounts[0] ? String(accounts[0].id) : "" });
    setError("");
    setResult(null);
    setStage("edit");
  }

  const sourceAccount = accounts.find((account) => String(account.id) === form.cuenta_origen_id);

  return (
    <div className="page-stack">
      <PageHeading eyebrow="MOVÉ TU DINERO CON CONFIANZA" title="Nueva transferencia" description="Enviá dinero a cualquier cuenta con CBU o CVU." />
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {loading ? <LoadingState label="Preparando tus cuentas..." /> : accounts.length === 0 ? (
        <EmptyState title="No hay una cuenta disponible">No podemos iniciar una transferencia sin una cuenta de origen.</EmptyState>
      ) : stage === "success" ? (
        <section className="operation-result">
          <span className="result-mark"><Check size={26} aria-hidden="true" /></span>
          <span className="eyebrow">TRANSFERENCIA REALIZADA</span>
          <h2>Listo, ya está en camino.</h2>
          <strong className="result-amount">{formatMoney(result.monto)}</strong>
          <p>La transferencia se procesó correctamente. Tu saldo quedó en {formatMoney(result.saldo_resultante)}.</p>
          <div className="result-detail">
            <span>{result.destino_tipo === "alias" ? "Alias destino" : "CBU / CVU destino"}</span><strong>{result.destino || form.destino}</strong>
            {result.descripcion && <><span>Concepto</span><strong>{result.descripcion}</strong></>}
          </div>
          <button type="button" className="button button-primary" onClick={startAnother}>Hacer otra transferencia <ArrowRight size={17} /></button>
        </section>
      ) : stage === "confirm" ? (
        <section className="confirmation-card">
          <button type="button" className="back-button" onClick={() => { setError(""); setStage("edit"); }} disabled={sending}>
            <ArrowLeft size={16} /> Volver y editar
          </button>
          <span className="eyebrow">REVISÁ ANTES DE ENVIAR</span>
          <h2>Confirmá los datos</h2>
          <p className="confirmation-lead">Verificá que el importe y el destino sean correctos.</p>
          <div className="transfer-summary">
            <div className="summary-icon"><ArrowUpRight size={20} /></div>
            <div><span>Vas a transferir</span><strong>{formatMoney(form.monto)}</strong></div>
          </div>
          <dl className="detail-list">
            <div><dt>Desde</dt><dd>Cuenta ····{String(sourceAccount?.cbu || "").slice(-4)}</dd></div>
            <div><dt>Hacia · { /^\d{22}$/.test(form.destino.trim()) ? "CBU / CVU" : "Alias"}</dt><dd className="account-destination">{form.destino}</dd></div>
            {form.descripcion.trim() && <div><dt>Concepto</dt><dd>{form.descripcion.trim()}</dd></div>}
          </dl>
          <div className="alert alert-info"><ShieldCheck size={18} /><span>Las transferencias se procesan de forma segura. Revisá bien los datos antes de continuar.</span></div>
          <button type="button" className="button button-primary button-wide" onClick={confirmTransfer} disabled={sending}>
            {sending ? "Procesando transferencia..." : "Confirmar y transferir"} <ArrowRight size={17} />
          </button>
        </section>
      ) : (
        <div className="two-column-layout">
          <section className="content-card operation-form-card">
            <div className="section-heading">
              <div><span className="eyebrow">NUEVO ENVÍO</span><h2>Datos de la transferencia</h2></div>
              <span className="secure-tag"><ShieldCheck size={15} /> Segura</span>
            </div>
            <form className="form-stack" onSubmit={prepareReview}>
              <AccountSelect accounts={accounts} value={form.cuenta_origen_id} onChange={(value) => setForm((current) => ({ ...current, cuenta_origen_id: value }))} />
              <Field id="destino" name="destino" label="Alias o CBU/CVU de destino" autoComplete="off" maxLength={30} placeholder="alias.bancario o 22 dígitos" hint="Podés transferir con un alias bancario (6 a 30 caracteres, sin espacios) o con los 22 números del CBU/CVU." value={form.destino} onChange={updateField} required />
              <Field id="monto" name="monto" label="¿Cuánto querés enviar?" type="text" inputMode="decimal" pattern="\d+(\.\d{1,2})?" placeholder="0,00" hint="Importe en pesos argentinos (ARS)." value={form.monto} onChange={updateField} required />
              <Field id="descripcion" name="descripcion" label="Concepto (opcional)" maxLength={140} placeholder="Por ejemplo, alquiler" value={form.descripcion} onChange={updateField} />
              <div className="alert alert-info"><CircleHelp size={17} /><span>Antes de confirmar, vas a poder revisar los datos de tu envío.</span></div>
              <button type="submit" className="button button-primary button-wide">Revisar transferencia <ArrowRight size={17} /></button>
            </form>
          </section>
          <section className="content-card recent-transfers-card">
            <div className="section-heading">
              <div><span className="eyebrow">TU ACTIVIDAD</span><h2>Transferencias recientes</h2></div>
            </div>
            {transfers.length ? (
              <div className="movement-list compact-list">
                {transfers.slice(0, 5).map((transfer) => {
                  const sent = accounts.some((account) => account.id === transfer.cuenta_origen_id);
                  return (
                    <div className="movement-row" key={transfer.id}>
                      <span className={`movement-icon ${sent ? "negative" : "positive"}`}>{sent ? <ArrowUpRight size={18} /> : <ArrowDownLeft size={18} />}</span>
                      <div className="movement-description"><strong>{sent ? "Enviada" : "Recibida"}</strong><span>{formatDate(transfer.created_at)}</span></div>
                      <strong className={`movement-amount ${sent ? "" : "text-positive"}`}>{sent ? "−" : "+"}{formatMoney(transfer.monto)}</strong>
                    </div>
                  );
                })}
              </div>
            ) : <EmptyState title="Sin transferencias recientes">Tus transferencias van a aparecer acá.</EmptyState>}
          </section>
        </div>
      )}
    </div>
  );
}
