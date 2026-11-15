import { useEffect, useMemo, useState } from "react";
import { ImagePlus, Save, UserRound } from "lucide-react";
import { ErrorMessage, Field, LoadingState, PageHeading } from "../components/PageStates";
import { useAuth } from "../auth/useAuth";
import { api, getApiError } from "../lib/api";
import { formatDate } from "../lib/format";

const EMPTY_PROFILE = { alias: null, alias_updated_at: null, avatar_url: null };
const ALIAS_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,29}$/u;
const ALIAS_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeAlias(value) {
  const trimmed = value.trim();
  return trimmed || null;
}

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
  const [form, setForm] = useState({ alias: "", avatar_url: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    let active = true;
    api.get("/auth/me")
      .then(({ data }) => {
        if (!active) return;
        const user = data.usuario;
        setProfile(user);
        setForm({ alias: user.alias || "", avatar_url: user.avatar_url || "" });
        setNow(Date.now());
        updateUser(user);
      })
      .catch((requestError) => { if (active) setError(getApiError(requestError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [updateUser]);

  const aliasAvailableAt = useMemo(() => {
    if (!profile.alias_updated_at) return null;
    const updatedAt = new Date(profile.alias_updated_at);
    if (Number.isNaN(updatedAt.getTime())) return null;
    return new Date(updatedAt.getTime() + ALIAS_COOLDOWN_MS);
  }, [profile.alias_updated_at]);
  const aliasLocked = Boolean(aliasAvailableAt && aliasAvailableAt.getTime() > now);
  const aliasHint = aliasLocked
    ? `Podés volver a cambiarlo desde el ${formatDate(aliasAvailableAt.toISOString())}. La API aplica el límite de 30 días.`
    : profile.alias_updated_at
      ? `Último cambio registrado por la API: ${formatDate(profile.alias_updated_at)}. Podés cambiarlo nuevamente; luego vuelve a aplicar el límite de 30 días.`
      : "La API no registra un cambio previo de alias. Después de guardarlo, aplica una espera de 30 días.";
  const firstLetter = (profile.nombre || "N").slice(0, 1).toUpperCase();

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
    setError("");
    setNotice("");
  }

  async function saveProfile(event) {
    event.preventDefault();
    setError("");
    setNotice("");

    const alias = normalizeAlias(form.alias);
    const currentAlias = profile.alias || null;
    if (alias !== currentAlias && alias !== null && !ALIAS_PATTERN.test(alias)) {
      setError("El alias debe tener entre 2 y 30 caracteres y comenzar con una letra o número.");
      return;
    }
    if (aliasLocked && alias !== currentAlias) {
      setError(`Podés volver a cambiar el alias desde el ${formatDate(aliasAvailableAt.toISOString())}. La API controla este límite.`);
      return;
    }

    const avatar = validateAvatarUrl(form.avatar_url);
    if (avatar.error) {
      setError(avatar.error);
      return;
    }

    const payload = {};
    if (alias !== currentAlias) payload.alias = alias;
    if (avatar.value !== (profile.avatar_url || null)) payload.avatar_url = avatar.value;
    if (!Object.keys(payload).length) {
      setNotice("No hay cambios para guardar.");
      return;
    }

    setSaving(true);
    try {
      const { data } = await api.patch("/auth/me", payload);
      setProfile(data.usuario);
      setForm({ alias: data.usuario.alias || "", avatar_url: data.usuario.avatar_url || "" });
      setAvatarFailed(false);
      updateUser(data.usuario);
      setNotice("Tu perfil se actualizó correctamente.");
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="TU ESPACIO PERSONAL"
        title="Tu perfil"
        description="Personalizá cómo te identificás en NeoBank."
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
              <span className="eyebrow">VISTA PREVIA</span>
              <strong>{form.alias.trim() || profile.nombre || "Tu perfil"}</strong>
            </div>
          </div>

          <form className="form-stack profile-form" onSubmit={saveProfile} noValidate>
            <div className="profile-section-heading">
              <UserRound size={18} aria-hidden="true" />
              <h2>Datos visibles</h2>
            </div>
            <Field
              id="profile-alias"
              name="alias"
              label="Alias"
              value={form.alias}
              onChange={updateField}
              placeholder="Ej.: Sol Perez"
              minLength={2}
              maxLength={30}
              disabled={aliasLocked}
              hint={`${aliasHint} Usá de 2 a 30 letras, números, espacios, puntos, guiones o guiones bajos.`}
            />
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
                  value={form.avatar_url}
                  onChange={updateField}
                  placeholder="https://ejemplo.com/mi-avatar.jpg"
                  aria-describedby="profile-avatar-hint"
                />
              </div>
              <span id="profile-avatar-hint" className="field-hint">Pegá un enlace HTTP o HTTPS. No se suben archivos.</span>
            </div>
            <button type="submit" className="button button-primary profile-save" disabled={saving}>
              <Save size={16} aria-hidden="true" />
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
