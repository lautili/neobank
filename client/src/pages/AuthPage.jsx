import { useState } from "react";
import { ArrowRight, Eye, EyeOff, ShieldCheck, Sparkles } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { ErrorMessage, Field } from "../components/PageStates";
import { api, getApiError } from "../lib/api";

function validateRegistration(form) {
  if (!/^[\p{L} ]{2,100}$/u.test(form.nombre.trim())) return "Ingresá un nombre de 2 a 100 letras.";
  if (!/^[\p{L} ]{2,100}$/u.test(form.apellido.trim())) return "Ingresá un apellido de 2 a 100 letras.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) || form.email.trim().length > 255) {
    return "Ingresá un email válido.";
  }
  if (new TextEncoder().encode(form.password).length < 8 || new TextEncoder().encode(form.password).length > 72) {
    return "La contraseña debe tener entre 8 y 72 bytes.";
  }
  if (!/^\d{7,8}$/.test(form.dni.trim())) return "El DNI debe tener 7 u 8 números.";
  return "";
}

export default function AuthPage() {
  const isRegister = useLocation().pathname === "/registro";
  const location = useLocation();
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [form, setForm] = useState({
    nombre: "",
    apellido: "",
    email: "",
    dni: "",
    password: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (isRegister) {
      const validationError = validateRegistration(form);
      if (validationError) {
        setError(validationError);
        return;
      }
    } else if (!form.email.trim() || !form.password) {
      setError("Completá tu email y contraseña.");
      return;
    }

    setLoading(true);
    try {
      const endpoint = isRegister ? "/auth/register" : "/auth/login";
      const payload = isRegister
        ? { ...form, nombre: form.nombre.trim(), apellido: form.apellido.trim(), email: form.email.trim(), dni: form.dni.trim() }
        : { email: form.email.trim(), password: form.password };
      const { data } = await api.post(endpoint, payload);
      signIn(data.token, data.usuario);
      navigate(location.state?.from?.pathname || "/", { replace: true });
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <Link className="brand auth-brand" to="/login">
          <span className="brand-mark">N</span><span>neo<span className="brand-light">bank</span></span>
        </Link>
        <div className="auth-story">
          <span className="auth-pill"><Sparkles size={14} aria-hidden="true" /> TU BANCO, A TU MANERA</span>
          <h1>Una forma más simple de estar <span>en control.</span></h1>
          <p>Tu dinero y tus decisiones, en un solo lugar. Fácil, claro y siempre disponible.</p>
        </div>
        <div className="auth-promise">
          <ShieldCheck size={19} aria-hidden="true" />
          <span>Acceso protegido a tu espacio personal</span>
        </div>
        <span className="auth-decoration auth-decoration-one" aria-hidden="true" />
        <span className="auth-decoration auth-decoration-two" aria-hidden="true" />
      </section>

      <section className="auth-form-side">
        <div className="auth-form-wrap">
          <span className="eyebrow">{isRegister ? "EMPEZÁ HOY" : "QUÉ BUENO VERTE"}</span>
          <h2>{isRegister ? "Creá tu cuenta" : "Ingresá a tu cuenta"}</h2>
          <p className="auth-form-lead">
            {isRegister ? "Unos datos y ya estás más cerca." : "Tu próximo paso empieza acá."}
          </p>

          <form className="form-stack" onSubmit={handleSubmit} noValidate>
            {isRegister && (
              <>
                <div className="form-row">
                  <Field id="nombre" name="nombre" label="Nombre" autoComplete="given-name" value={form.nombre} onChange={updateField} required />
                  <Field id="apellido" name="apellido" label="Apellido" autoComplete="family-name" value={form.apellido} onChange={updateField} required />
                </div>
                <Field id="dni" name="dni" label="DNI" inputMode="numeric" autoComplete="off" maxLength={8} value={form.dni} onChange={updateField} required />
              </>
            )}
            <Field id="email" name="email" label="Email" type="email" autoComplete="email" value={form.email} onChange={updateField} required />
            <div className="field">
              <label htmlFor="password">Contraseña</label>
              <div className="password-field">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  minLength={isRegister ? 8 : undefined}
                  maxLength={72}
                  value={form.password}
                  onChange={updateField}
                  required
                />
                <button type="button" className="password-toggle" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {isRegister && <span className="field-hint">Usá al menos 8 caracteres.</span>}
            </div>

            <ErrorMessage>{error}</ErrorMessage>
            <button type="submit" className="button button-primary button-wide" disabled={loading}>
              {loading ? "Un momento..." : isRegister ? "Crear cuenta" : "Ingresar"}
              {!loading && <ArrowRight size={18} aria-hidden="true" />}
            </button>
          </form>

          <p className="auth-switch">
            {isRegister ? "¿Ya tenés cuenta?" : "¿Todavía no tenés cuenta?"}{" "}
            <Link to={isRegister ? "/login" : "/registro"}>{isRegister ? "Iniciá sesión" : "Abrí tu cuenta"}</Link>
          </p>
          <p className="auth-disclaimer">Al continuar, tus datos se usan para crear y proteger tu cuenta.</p>
        </div>
      </section>
    </main>
  );
}
