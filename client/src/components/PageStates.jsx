import { AlertCircle, LoaderCircle } from "lucide-react";
import { formatMoney } from "../lib/format";

export function LoadingState({ label = "Cargando información..." }) {
  return (
    <div className="state-card" role="status">
      <LoaderCircle className="spin" size={20} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorMessage({ children }) {
  if (!children) return null;
  return (
    <div className="alert alert-error" role="alert">
      <AlertCircle size={18} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="empty-state">
      <span className="empty-state-mark" aria-hidden="true">N</span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function PageHeading({ eyebrow, title, description, action }) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Field({ label, id, hint, ...inputProps }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-describedby={hint ? `${id}-hint` : undefined} {...inputProps} />
      {hint && <span id={`${id}-hint`} className="field-hint">{hint}</span>}
    </div>
  );
}

export function AccountSelect({ accounts, value, onChange, id = "cuenta" }) {
  if (accounts.length === 0) return null;
  return (
    <div className="field">
      <label htmlFor={id}>Cuenta de origen</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} required>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
              Cuenta ····{String(account.cbu).slice(-4)}{account.alias ? ` · ${account.alias}` : ""} · {formatMoney(account.saldo)}
          </option>
        ))}
      </select>
    </div>
  );
}
