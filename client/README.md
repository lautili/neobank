# NeoBank frontend

Aplicación React + Vite para los flujos del MVP: autenticación, cuentas, movimientos, transferencias, tarjetas, préstamos y plazos fijos.

## Requisitos

- Node.js compatible con Vite 8 (Node.js 20.19+ o 22.12+).
- API y MySQL configurados según [../server/.env.example](../server/.env.example).

## Desarrollo local

```powershell
Copy-Item .env.example .env
npm.cmd install
npm.cmd run dev
```

La aplicación se sirve en `http://localhost:5173` y usa por defecto `http://localhost:3000/api`. Si la API está en otra dirección, configurá `VITE_API_URL` en `.env` con la URL base completa, incluido `/api`. El backend debe permitir el origen del frontend mediante `CORS_ORIGIN`.

## Verificaciones

```powershell
npm.cmd run lint
npm.cmd run build
```

## Sesión

El JWT se guarda en `sessionStorage` según la decisión del proyecto. La sesión sobrevive a una recarga, pero termina al cerrar la pestaña y el token queda accesible para JavaScript en esa pestaña; por eso esta opción requiere evitar XSS y nunca registrar ni mostrar el token. Se elimina al cerrar sesión o cuando la API responde `401`.

Las simulaciones de préstamos y plazos fijos usan los cálculos del servidor. Las operaciones financieras envían una clave `Idempotency-Key` y conservan la misma clave para reintentar únicamente la misma solicitud.
