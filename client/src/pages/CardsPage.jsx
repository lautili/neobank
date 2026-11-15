import { useEffect, useState } from "react";
import { CreditCard, LockKeyhole, ShieldCheck, UnlockKeyhole } from "lucide-react";
import { ErrorMessage, EmptyState, LoadingState, PageHeading } from "../components/PageStates";
import { api, getApiError } from "../lib/api";
import { formatMoney } from "../lib/format";

export default function CardsPage() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api.get("/tarjetas")
      .then(({ data }) => { if (active) setCards(data); })
      .catch((requestError) => { if (active) setError(getApiError(requestError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function toggleCard(card) {
    const estado = card.estado === "activa" ? "bloqueada" : "activa";
    setUpdatingId(card.id);
    setError("");
    try {
      const { data } = await api.patch(`/tarjetas/${card.id}`, { estado });
      setCards((current) => current.map((item) => item.id === card.id ? data : item));
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="page-stack">
      <PageHeading eyebrow="SIEMPRE BAJO TU CONTROL" title="Tus tarjetas" description="Revisá tus tarjetas y elegí cuándo están listas para usar." />
      <ErrorMessage>{error}</ErrorMessage>
      {loading ? <LoadingState label="Cargando tarjetas..." /> : cards.length ? (
        <section className="card-grid" aria-label="Tarjetas asociadas">
          {cards.map((card, index) => {
            const blocked = card.estado === "bloqueada";
            return (
              <article className={`bank-card ${index % 2 ? "bank-card-alt" : ""} ${blocked ? "bank-card-blocked" : ""}`} key={card.id}>
                <div className="bank-card-top">
                  <span className="brand bank-card-brand"><span className="brand-mark">N</span><span>neo<span className="brand-light">bank</span></span></span>
                  <CreditCard size={22} aria-hidden="true" />
                </div>
                <div className="bank-card-number">{card.numero_enmascarado}</div>
                <div className="bank-card-bottom">
                  <span>{card.tipo === "debito" ? "DÉBITO" : "CRÉDITO"}</span>
                  <span className={`card-status ${blocked ? "blocked" : ""}`}>
                    {blocked ? <LockKeyhole size={13} /> : <ShieldCheck size={13} />}
                    {blocked ? "Bloqueada" : "Activa"}
                  </span>
                </div>
                {card.limite_credito != null && (
                  <div className="card-limit">Límite disponible <strong>{formatMoney(card.limite_credito)}</strong></div>
                )}
                <button
                  type="button"
                  className={`button ${blocked ? "button-light" : "button-card-ghost"}`}
                  onClick={() => toggleCard(card)}
                  disabled={updatingId === card.id}
                >
                  {blocked ? <UnlockKeyhole size={16} /> : <LockKeyhole size={16} />}
                  {updatingId === card.id ? "Actualizando..." : blocked ? "Desbloquear tarjeta" : "Bloquear tarjeta"}
                </button>
              </article>
            );
          })}
        </section>
      ) : <EmptyState title="Todavía no hay tarjetas">Las tarjetas asociadas a tus cuentas aparecen acá.</EmptyState>}
    </div>
  );
}
