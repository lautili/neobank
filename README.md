# NeoBank

NeoBank es una aplicación de banca digital y billetera virtual desarrollada como MVP para simular operaciones bancarias cotidianas con autenticación, cuentas, transferencias, tarjetas, préstamos y plazos fijos.

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Base de datos: MySQL
- Autenticación: JWT + bcrypt
- Seguridad: rate limiting, idempotency keys y validación de dinero/transacciones

## Estructura del proyecto

```text
neobank/
├── client/          # Frontend React/Vite
├── server/          # API Express
├── db/              # Esquema SQL y configuración de base de datos
├── AGENTS.md        # Instrucciones del proyecto para agentes
├── SPECS.md         # Especificaciones técnicas y alcance
├── README.md        # Documentación principal
└── ...
```

## Requisitos previos

- Node.js 20+ recomendado
- MySQL 8+
- npm

## Configuración de la base de datos

1. Crear la base de datos y tablas:

```bash
mysql -u root -p < db/schema.sql
```

2. Verificar que la base de datos `neobank` quedó creada correctamente.

Para una base ya existente, ejecutar `npm run db:setup` desde `server` para aplicar las columnas y ENUMs requeridos; el setup es idempotente.

## Configuración del backend

1. Entrar a la carpeta `server`.
2. Copiar el ejemplo de variables de entorno:

```bash
copy .env.example .env
```

3. Ajustar los valores según tu entorno local, por ejemplo:

```env
PORT=3000
CORS_ORIGIN=http://localhost:5173
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=neobank
JWT_SECRET=cambia-este-secreto-por-uno-largo
```

4. Instalar dependencias y levantar el servidor:

```bash
npm install
npm run dev
```

La API queda disponible en `http://localhost:3000`.

## Configuración del frontend

1. Entrar a la carpeta `client`.
2. Copiar el ejemplo de configuración:

```bash
copy .env.example .env
```

3. Confirmar la URL base de la API:

```env
VITE_API_URL=http://localhost:3000/api
```

4. Instalar dependencias y arrancar la app:

```bash
npm install
npm run dev
```

La interfaz queda disponible en `http://localhost:5173`.

## Módulos principales

- Autenticación: registro, login y protección de rutas
- Cuentas y saldo: visualización del balance y detalles del CBU/CVU
- Transferencias: movimientos entre cuentas con validaciones y registros transaccionales
- Tarjetas: listado y estado de tarjetas asociadas
- Préstamos: simulación y creación de préstamos
- Plazos fijos: cálculo de intereses y alta de inversiones
- Perfil: edición de alias (un cambio cada 30 días, validado por el servidor) y URL de avatar

### Tarjetas de demostración

La tarjeta muestra un identificador de 16 dígitos generado en la interfaz a partir del ID de cada tarjeta. El identificador incluye el prefijo visual `55` y un dígito de control deliberadamente inválido; por ello es distinto y estable por tarjeta, pero no es un PAN ni sirve para pagos. No se envía al servidor ni se persiste.

### Plazos fijos

El listado muestra desde la API el beneficio y total estimados al vencimiento. Al consultar la lista de cuentas o la de plazos fijos, los vencidos se liquidan transaccionalmente: se acredita capital más el beneficio calculado por la fórmula de la demo, se registra un movimiento y el estado cambia una sola vez a finalizado. Un plazo activo puede cancelarse antes de vencer: la política de esta demo devuelve el capital íntegro, sin intereses ni penalidad. Los rescatados quedan como cancelados y la UI no presenta el beneficio estimado como percibido.

La liquidación queda registrada por plazo. También se reconcilian plazos vencidos que una versión anterior pudo haber marcado como finalizados sin acreditar los fondos; si el saldo no admite el crédito completo, el estado no se marca como liquidado.

## Verificaciones y pruebas

En `server`:

```bash
npm test
```

En `client`:

```bash
npm run build
```

## Scripts útiles

### Backend

```bash
npm run dev
npm run start
npm run db:setup
npm test
```

### Frontend

```bash
npm run dev
npm run build
npm run preview
```

## Notas

- El backend usa MySQL con transacciones para operaciones financieras.
- El frontend consume la API a través de `VITE_API_URL`.
- Se recomienda no commitear secretos reales ni archivos `.env` de entorno local.
