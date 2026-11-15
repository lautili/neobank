# Especificación Técnica (SPEC) - NeoBank MVP

## 1. Visión General del Proyecto
NeoBank es una plataforma de banca digital y billetera virtual orientada a simular operaciones financieras cotidianas con alta robustez, seguridad transaccional y una interfaz de usuario limpia y moderna.

## 2. Stack Tecnológico
* **Frontend:** React (Vite), Tailwind CSS, Lucide Icons, Axios.
* **Backend:** Node.js, Express.js.
* **Base de Datos:** SQL (PostgreSQL / MySQL) con `node-postgres` o `mysql2`.
* **Seguridad / Utilidades:** JWT para autenticación, `bcrypt` para hashing de contraseñas, `dotenv` para gestión de secretos.

## 3. Arquitectura de Base de Datos (Esquema SQL)

### Tablas Principales:
1. **`usuarios`**
   * `id` (SERIAL / INT, PK)
   * `nombre`, `apellido`, `email` (UNIQUE), `password_hash`, `dni` (UNIQUE), `created_at`
2. **`cuentas`**
   * `id` (SERIAL / INT, PK)
   * `usuario_id` (INT, FK -> usuarios.id)
   * `cbu` / `cvu` (VARCHAR, UNIQUE)
   * `saldo` (DECIMAL(12,2), DEFAULT 0.00)
   * `moneda` (VARCHAR(3), DEFAULT 'ARS')
   * `created_at`
3. **`tarjetas`**
   * `id` (SERIAL / INT, PK)
   * `cuenta_id` (INT, FK -> cuentas.id)
   * `numero_enmascarado` (VARCHAR)
   * `tipo` (ENUM: 'debito', 'credito')
   * `estado` (ENUM: 'activa', 'bloqueada')
   * `limite_credito` (DECIMAL(12,2), NULL para débito)
4. **`transferencias`**
   * `id` (SERIAL / INT, PK)
   * `cuenta_origen_id` (INT, FK -> cuentas.id)
   * `cuenta_destino_id` (INT, FK -> cuentas.id)
   * `monto` (DECIMAL(12,2))
   * `descripcion` (TEXT)
   * `created_at`
5. **`movimientos`** (Historial unificado de transacciones)
   * `id` (SERIAL / INT, PK)
   * `cuenta_id` (INT, FK -> cuentas.id)
   * `tipo` (ENUM: 'ingreso', 'extraccion', 'transferencia_enviada', 'transferencia_recibida', 'prestamo', 'plazo_fijo')
   * `monto` (DECIMAL(12,2))
   * `saldo_resultante` (DECIMAL(12,2))
   * `referencia_id` (INT, NULL - ID de la tabla relacionada ej. transferencia_id)
   * `created_at`
6. **`prestamos`**
   * `id` (SERIAL / INT, PK)
   * `usuario_id` (INT, FK -> usuarios.id)
   * `monto_solicitado` (DECIMAL(12,2))
   * `cuotas` (INT)
   * `tasa_interes` (DECIMAL(5,2))
   * `estado` (ENUM: 'pendiente', 'activo', 'pagado')
   * `created_at`
7. **`plazos_fijos`**
   * `id` (SERIAL / INT, PK)
   * `cuenta_id` (INT, FK -> cuentas.id)
   * `monto_invertido` (DECIMAL(12,2))
   * `tasa_nominal_anual` (DECIMAL(5,2))
   * `dias` (INT)
   * `fecha_inicio` (DATE)
   * `fecha_vencimiento` (DATE)
   * `estado` (ENUM: 'activo', 'finalizado')

## 4. Requerimientos Funcionales por Módulo
* **Autenticación:** Registro de usuarios, login seguro con JWT y protección de rutas en el frontend.
* **Cuentas y Saldo:** Visualización del balance actual y detalle de CBU/CVU.
* **Transferencias:** Capacidad de transferir fondos entre cuentas propias o de terceros, generando automáticamente los registros en la tabla `movimientos` dentro de una **transacción SQL atómica** (ACID).
* **Tarjetas:** Visualización de tarjetas asociadas, estado de bloqueo/desbloqueo.
* **Préstamos y Plazos Fijos:** Simulador y alta de préstamos con cálculo de cuotas, e inversión en plazos fijos con cálculo de intereses a fecha de vencimiento.

## 5. Contratos operativos de la API
* Los `POST` que realizan movimientos de ingreso/extracción (`/api/cuentas/:id/movimientos`), transferencias (`/api/transferencias`), préstamos (`/api/prestamos`) o plazos fijos (`/api/plazos-fijos`) requieren `Idempotency-Key`. Debe contener entre 1 y 128 caracteres ASCII imprimibles (sin espacios). Una clave se aplica al usuario autenticado y al endpoint, no se puede reutilizar con otro payload (HTTP 409) y un reintento idéntico devuelve la respuesta original. La clave, el hash del payload, el resultado y la operación se guardan en la base de datos en la misma transacción; no dependen de memoria del proceso.
* El esquema/bootstrap crea `idempotency_requests` con unicidad SQL por usuario, operación y hash de clave. No se eliminan registros de idempotencia automáticamente: borrarlos permitiría repetir una operación financiera antigua. Planificar retención solamente con una política que preserve el plazo de reintentos esperado.
* Los saldos y créditos se mantienen en centavos enteros y respetan el máximo `DECIMAL(12,2)` (`9.999.999.999,99`). Ingresos simulados y préstamos automáticos siguen habilitados; una operación se rechaza solo si el saldo resultante excede ese máximo.
* El limitador de registro/login es en memoria por instancia, aplica una cantidad de claves máxima y devuelve HTTP 503 si se llena hasta que expire alguna. Expira y limpia buckets periódicamente. Sus valores desplegables son `AUTH_RATE_LIMIT_LIMIT`, `AUTH_RATE_LIMIT_WINDOW_MS` y `AUTH_RATE_LIMIT_MAX_KEYS` (ver `server/.env.example`). No se activa `trust proxy` globalmente: `req.ip` se basa en la conexión directa salvo configuración explícita de una topología de proxy confiable. Detrás de un proxy sin configurar, los clientes pueden compartir IP; con varias instancias el límite no se comparte y cada instancia tiene su propio presupuesto.
* `withTransaction` devuelve conexiones al pool solo tras commit o rollback exitoso. Si falla rollback, la conexión se destruye; si falla commit, el desenlace se considera desconocido, la conexión se destruye y la API devuelve HTTP 503. Reintentar esa solicitud con la misma clave permite resolver/reproducir el resultado sin duplicar la operación.
