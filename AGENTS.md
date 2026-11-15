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

## Commits de agentes

Al finalizar una tarea que implique cambios, los agentes pueden crear un commit sin pedir autorización adicional, una vez que hayan verificado los cambios y ejecutado las pruebas pertinentes.

Antes de crear el commit, deben revisar el estado y el diff de Git, y agregar únicamente los archivos modificados por su tarea. No deben incluir cambios preexistentes o ajenos a la tarea ni usar comandos de staging globales como `git add -A`. No deben hacer push salvo que el usuario lo solicite explícitamente.
