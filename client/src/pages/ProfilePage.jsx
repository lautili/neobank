import { useEffect, useMemo, useState } from "react";
import { ImagePlus, Save, UserRound } from "lucide-react";
import { ErrorMessage, Field, LoadingState, PageHeading } from "../components/PageStates";
import { useAuth } from "../auth/useAuth";
import { api, getApiError } from "../lib/api";
import { formatDate } from "../lib/format";

const EMPTY_PROFILE = { nombre: "", avatar_url: null };
const ALIAS_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{5,29}$/;
const ALIAS_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

function validateAvatarUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return { value: null };
  if (trimmed.length > 2048) return { error: "La URL del avatar no puede superar los 2048 caracteres." };
  try {
    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
      return { error: "Ingresá una URL HTTP o HTTPS válida, sin usuario ni contraseña." };
    }
    return { value: url.href };
  } catch {
    return { error: "Ingresá una URL HTTP o HTTPS válida." };
  }
}

export default function ProfilePage() {
  const { updateUser } = useAuth();
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [alias, setAlias] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [savingAlias, setSavingAlias] = useState(false);
  const [now, setNow] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([api.get("/auth/me"), api.get("/cuentas")])
      .then(([profileResult, accountsResult]) => {
        if (!active) return;
        const user = profileResult.data.usuario;
        const loadedAccounts = accountsResult.data;
        setProfile(user);
        setAvatarUrl(user.avatar_url || "");
        setAccounts(loadedAccounts);
        if (loadedAccounts[0]) {
          setSelectedAccountId(String(loadedAccounts[0].id));
          setAlias(loadedAccounts[0].alias || "");
        }
        setNow(Date.now());
        updateUser(user);
      })
      .catch((requestError) => { if (active) setError(getApiError(requestError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [updateUser]);

  const selectedAccount = accounts.find((account) => String(account.id) === selectedAccountId);
  const aliasAvailableAt = useMemo(() => {
    if (!selectedAccount?.alias_updated_at) return null;
    const updatedAt = new Date(selectedAccount.alias_updated_at);
    if (Number.isNaN(updatedAt.getTime())) return null;
    return new Date(updatedAt.getTime() + ALIAS_COOLDOWN_MS);
  }, [selectedAccount]);
  const aliasLocked = Boolean(aliasAvailableAt && aliasAvailableAt.getTime() > now);
  const aliasHint = aliasLocked
    ? `Podés volver a cambiarlo desde el ${formatDate(aliasAvailableAt.toISOString())}. La API aplica el límite por cuenta.`
    : selectedAccount?.alias_updated_at
      ? `Último cambio: ${formatDate(selectedAccount.alias_updated_at)}. Luego de guardar vuelve a aplicar el límite de 30 días.`
      : "Esta cuenta todavía no tiene alias. Al definirlo, comienza el límite de 30 días.";
  const firstLetter = (profile.nombre || "N").slice(0, 1).toUpperCase();

  function changeAccount(event) {
    const id = event.target.value;
    const account = accounts.find((item) => String(item.id) === id);
    setSelectedAccountId(id);
    setAlias(account?.alias || "");
    setError("");
    setNotice("");
  }

  async function saveAlias(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!selectedAccount) return;
    const nextAlias = alias.trim().toLowerCase() || null;
    if (nextAlias !== selectedAccount.alias && nextAlias !== null && !ALIAS_PATTERN.test(nextAlias)) {
      setError("El alias debe tener de 6 a 30 letras, números, puntos, guiones o guiones bajos, sin espacios.");
      return;
    }
    if (aliasLocked && nextAlias !== selectedAccount.alias) {
      setError(`Podés volver a cambiar el alias desde el ${formatDate(aliasAvailableAt.toISOString())}.`);
      return;
    }
    if (nextAlias === selectedAccount.alias) {
      setNotice("No hay cambios para guardar.");
      return;
    }

    setSavingAlias(true);
    try {
      const { data } = await api.patch(`/cuentas/${selectedAccount.id}/alias`, { alias: nextAlias });
      setAccounts((current) => current.map((account) => account.id === data.cuenta.id ? data.cuenta : account));
      setAlias(data.cuenta.alias || "");
      setNotice("El alias de la cuenta se actualizó correctamente.");
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setSavingAlias(false);
    }
  }

  async function saveAvatar(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    const avatar = validateAvatarUrl(avatarUrl);
    if (avatar.error) {
      setError(avatar.error);
      return;
    }
    if (avatar.value === (profile.avatar_url || null)) {
      setNotice("No hay cambios para guardar.");
      return;
    }
    setSavingAvatar(true);
    try {
      const { data } = await api.patch("/auth/me", { avatar_url: avatar.value });
      setProfile(data.usuario);
      setAvatarUrl(data.usuario.avatar_url || "");
      setAvatarFailed(false);
      updateUser(data.usuario);
      setNotice("Tu avatar se actualizó correctamente.");
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setSavingAvatar(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="TU ESPACIO PERSONAL"
        title="Tu perfil"
        description="Personalizá tu avatar y administrá el alias para recibir transferencias en cada cuenta."
      />
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {notice && <p className="profile-notice" role="status">{notice}</p>}
      {loading ? <LoadingState label="Cargando tu perfil..." /> : (
        <section className="content-card profile-card">
          <div className="profile-preview">
            {profile.avatar_url && !avatarFailed
              ? <img src={profile.avatar_url} alt="Vista previa del avatar" onError={() => setAvatarFailed(true)} />
              : <span aria-hidden="true">{firstLetter}</span>}
            <div>
              <span className="eyebrow">PERFIL PERSONAL</span>
              <strong>{profile.nombre || "Tu perfil"}</strong>
            </div>
          </div>

          <form className="form-stack profile-form" onSubmit={saveAvatar} noValidate>
            <div className="profile-section-heading">
              <UserRound size={18} aria-hidden="true" />
              <h2>Avatar</h2>
            </div>
            <div className="field">
              <label htmlFor="profile-avatar">URL del avatar</label>
              <div className="profile-url-field">
                <ImagePlus size={17} aria-hidden="true" />
                <input
                  id="profile-avatar"
                  name="avatar_url"
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  maxLength={2048}
                  value={avatarUrl}
                  onChange={(event) => setAvatarUrl(event.target.value)}
                  placeholder="https://ejemplo.com/mi-avatar.jpg"
                  aria-describedby="profile-avatar-hint"
                />
              </div>
              <span id="profile-avatar-hint" className="field-hint">Pegá un enlace HTTP o HTTPS. No se suben archivos.</span>
            </div>
            <button type="submit" className="button button-primary profile-save" disabled={savingAvatar}>
              <Save size={16} aria-hidden="true" />
              {savingAvatar ? "Guardando..." : "Guardar avatar"}
            </button>
          </form>

          <form className="form-stack profile-form" onSubmit={saveAlias} noValidate>
            <div className="profile-section-heading">
              <UserRound size={18} aria-hidden="true" />
              <h2>Alias de cuenta para transferencias</h2>
            </div>
            {accounts.length === 0 ? <p>No tenés cuentas disponibles para configurar un alias.</p> : (
              <>
                <div className="field">
                  <label htmlFor="profile-account">Cuenta</label>
                  <select id="profile-account" value={selectedAccountId} onChange={changeAccount}>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        Cuenta ····{String(account.cbu).slice(-4)} · {account.cbu}
                      </option>
                    ))}
                  </select>
                </div>
                <Field
                  id="profile-account-alias"
                  name="alias"
                  label="Alias bancario"
                  value={alias}
                  onChange={(event) => { setAlias(event.target.value); setError(""); setNotice(""); }}
                  placeholder="Ej.: sol.perez-1"
                  minLength={6}
                  maxLength={30}
                  disabled={aliasLocked}
                  hint={`${aliasHint} Usá de 6 a 30 letras, números, puntos, guiones o guiones bajos, sin espacios.`}
                />
                <button type="submit" className="button button-primary profile-save" disabled={savingAlias || aliasLocked}>
                  <Save size={16} aria-hidden="true" />
                  {savingAlias ? "Guardando..." : "Guardar alias de cuenta"}
                </button>
              </>
            )}
          </form>
        </section>
      )}
    </div>
  );
}
