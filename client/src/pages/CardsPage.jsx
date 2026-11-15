import { useEffect, useState } from "react";
import { LockKeyhole, ShieldCheck, UnlockKeyhole } from "lucide-react";
import { ErrorMessage, EmptyState, LoadingState, PageHeading } from "../components/PageStates";
import { api, getApiError } from "../lib/api";
import { formatMoney } from "../lib/format";

function hasValidLuhnChecksum(firstFifteen, checkDigit) {
  let sum = Number(checkDigit);
  for (let offset = 0; offset < firstFifteen.length; offset += 1) {
    let digit = Number(firstFifteen[firstFifteen.length - 1 - offset]);
    if (offset % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

// El ID SQL se incorpora sin pérdida; un dígito final fijo se ajusta solo si validara por Luhn.
// Este valor solo se genera en la UI, no se envía ni persiste y no es utilizable para pagos.
function demoIdentifierForCard(cardId) {
  const id = String(cardId);
  if (!/^\d{1,12}$/.test(id)) return "ID-DEMO-NO-VALIDO";
  const firstFourteen = `55${id.padStart(12, "0")}`;
  const firstFifteen = `${firstFourteen}0`;
  const invalidCheckDigit = hasValidLuhnChecksum(firstFifteen, "0") ? "1" : "0";
  const digits = `${firstFifteen}${invalidCheckDigit}`;
  return digits.match(/.{4}/g).join(" ");
}

export default function CardsPage() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api.get("/tarjetas")
      .then(({ data }) => {
        if (active) setCards(data);
      })
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
      setCards((current) => current.map((item) =>
        item.id === card.id ? data : item,
      ));
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
                  <span className="mastercard-mark" role="img" aria-label="Diseño visual inspirado en Mastercard, solo demostrativo">
                    <span />
                    <span />
                  </span>
                </div>
                <div className="bank-card-identifier">
                  <span>Identificador demo · no es número de tarjeta</span>
                  <strong>{demoIdentifierForCard(card.id)}</strong>
                </div>
                <div className="bank-card-bottom">
                  <span>{card.tipo === "debito" ? "DÉBITO" : "CRÉDITO"}</span>
                  <span className={`card-status ${blocked ? "blocked" : ""}`}>
                    {blocked ? <LockKeyhole size={13} /> : <ShieldCheck size={13} />}
                    {blocked ? "Bloqueada" : "Activa"}
                  </span>
                </div>
                {card.limite_credito != null && (
                  <div className="card-limit">Límite de crédito <strong>{formatMoney(card.limite_credito)}</strong></div>
                )}
                <p className="card-demo-warning">DEMO · No válida para pagos</p>
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
