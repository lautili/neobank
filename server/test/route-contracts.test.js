const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const dbPath = require.resolve("../src/db");
const authMiddlewarePath = require.resolve("../src/middleware/auth");
const idempotencyPath = require.resolve("../src/idempotency");
const dbModule = new Module(dbPath);
const authMiddlewareModule = new Module(authMiddlewarePath);
const idempotencyModule = new Module(idempotencyPath);

let poolQuery;
let transactionWork;
let idempotentOptions;
dbModule.filename = dbPath;
dbModule.loaded = true;
dbModule.exports = {
  pool: { query: (...args) => poolQuery(...args) },
  withTransaction: (work) => transactionWork(work),
};
authMiddlewareModule.filename = authMiddlewarePath;
authMiddlewareModule.loaded = true;
authMiddlewareModule.exports = {
  requireAuth: (_req, _res, next) => next(),
  rateLimit: () => (_req, _res, next) => next(),
  authRateLimit: 10,
  authRateWindowMs: 60_000,
  authRateMaxKeys: 10_000,
};
idempotencyModule.filename = idempotencyPath;
idempotencyModule.loaded = true;
idempotencyModule.exports = {
  runIdempotent: async (options) => {
    idempotentOptions = options;
    return { result: { id: options.payload.plazo_fijo_id, estado: "cancelado" } };
  },
};
require.cache[dbPath] = dbModule;
require.cache[authMiddlewarePath] = authMiddlewareModule;
require.cache[idempotencyPath] = idempotencyModule;

const authRouter = require("../src/routes/auth");
const accountsRouter = require("../src/routes/cuentas");
const fixedDepositsRouter = require("../src/routes/plazosFijos");

function routeHandler(router, method, routePath) {
  const layer = router.stack.find((item) => item.route
    && item.route.path === routePath
    && item.route.methods[method]);
  assert.ok(layer, `No se encontró la ruta ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function invoke(handler, req) {
  return new Promise((resolve, reject) => {
    let timeout;
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        clearTimeout(timeout);
        resolve({ status: this.statusCode, body });
      },
    };
    timeout = setTimeout(() => reject(new Error("La ruta no respondió")), 1000);
    handler(req, res, (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

test("GET /cuentas liquida vencimientos en la misma transacción antes de consultar saldos", async () => {
  const calls = [];
  let connection;
  let transactionCount = 0;
  let transactionCompleted = false;
  poolQuery = async () => {
    throw new Error("GET /cuentas no debe consultar el pool directamente");
  };
  connection = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("SELECT p.id, p.cuenta_id")) {
        return [[{
          id: 8,
          cuenta_id: 3,
          monto_invertido: "1000.00",
          tasa_nominal_anual: "36.00",
          dias: 30,
        }]];
      }
      if (sql.startsWith("SELECT id, saldo FROM cuentas")) {
        return [[{ id: 3, saldo: "25.10" }]];
      }
      if (sql.startsWith("UPDATE plazos_fijos")) return [{ affectedRows: 1 }];
      if (sql.startsWith("UPDATE cuentas SET saldo")) return [{}];
      if (sql.includes("INSERT INTO movimientos")) return [{}];
      if (sql.startsWith("SELECT id, usuario_id, cbu, cvu, saldo, moneda, created_at FROM cuentas")) {
        return [[{
          id: 3,
          usuario_id: 42,
          cbu: "123",
          cvu: "456",
          saldo: "1054.69",
          moneda: "ARS",
          created_at: "2026-01-01T00:00:00.000Z",
        }]];
      }
      throw new Error(`Consulta inesperada: ${sql}`);
    },
  };
  transactionWork = async (work) => {
    transactionCount += 1;
    const result = await work(connection);
    transactionCompleted = true;
    return result;
  };

  const response = await invoke(routeHandler(accountsRouter, "get", "/"), {
    user: { id: 42 },
  });

  assert.equal(transactionCount, 1);
  assert.equal(transactionCompleted, true);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, [{
    id: 3,
    usuario_id: 42,
    cbu: "123",
    cvu: "456",
    saldo: "1054.69",
    moneda: "ARS",
    created_at: "2026-01-01T00:00:00.000Z",
  }]);
  assert.equal(calls.length, 6);
  assert.match(calls[0].sql, /c\.usuario_id = \?/);
  assert.deepEqual(calls[0].params, [42]);
  assert.deepEqual(calls[1].params, [3, 42]);
  const balanceUpdate = calls.find(({ sql }) => sql.startsWith("UPDATE cuentas SET saldo"));
  assert.deepEqual(balanceUpdate.params, ["1054.69", 3]);
  const accountSelectionIndex = calls.findIndex(({ sql }) =>
    sql.startsWith("SELECT id, usuario_id, cbu, cvu, saldo, moneda, created_at FROM cuentas")
  );
  assert.equal(accountSelectionIndex, 5);
  assert.deepEqual(calls[accountSelectionIndex].params, [42]);
});

test("GET /cuentas propaga el error de liquidación y no consulta cuentas", async () => {
  const failure = new Error("falló la liquidación");
  const calls = [];
  const connection = {
    async query(sql) {
      calls.push(sql);
      throw failure;
    },
  };
  transactionWork = (work) => work(connection);

  await assert.rejects(
    invoke(routeHandler(accountsRouter, "get", "/"), { user: { id: 42 } }),
    (error) => error === failure
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0], /SELECT p\.id, p\.cuenta_id/);
});

test("GET /plazos-fijos liquida una sola vez los vencidos antes de devolverlos", async () => {
  const calls = [];
  transactionWork = async (work) => work({
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("p.liquidado_at IS NULL")) {
        return [[{
          id: 8,
          cuenta_id: 3,
          monto_invertido: "1000.00",
          tasa_nominal_anual: "36.00",
          dias: 30,
          estado: "finalizado",
          liquidado_at: null,
        }]];
      }
      if (sql.startsWith("SELECT id, saldo FROM cuentas")) {
        return [[{ id: 3, saldo: "25.10" }]];
      }
      if (sql.startsWith("UPDATE plazos_fijos")) return [{ affectedRows: 1 }];
      if (sql.startsWith("UPDATE cuentas")) return [{}];
      if (sql.includes("INSERT INTO movimientos")) return [{}];
      if (sql.includes("FROM plazos_fijos p")) {
        return [[{
          id: 8,
          cuenta_id: 3,
          monto_invertido: "1000.00",
          tasa_nominal_anual: "36.00",
          dias: 30,
          estado: "finalizado",
          liquidado_at: "2026-11-15T14:32:50.000Z",
        }]];
      }
      throw new Error(`Consulta inesperada: ${sql}`);
    },
  });

  const response = await invoke(routeHandler(fixedDepositsRouter, "get", "/"), {
    user: { id: 42 },
  });

  assert.equal(calls.length, 6);
  assert.match(calls[0].sql, /c\.usuario_id = \? AND p\.estado IN \('activo', 'finalizado'\)/);
  assert.match(calls[0].sql, /p\.liquidado_at IS NULL AND p\.fecha_vencimiento <= CURRENT_DATE/);
  assert.match(calls[0].sql, /FOR UPDATE/);
  assert.deepEqual(calls[0].params, [42]);
  assert.deepEqual(calls[1].params, [3, 42]);
  assert.deepEqual(calls[2].params, [8]);
  assert.match(calls[2].sql, /liquidado_at = UTC_TIMESTAMP\(\)/);
  assert.match(calls[2].sql, /WHERE id = \? AND estado IN \('activo', 'finalizado'\)/);
  assert.match(calls[2].sql, /liquidado_at IS NULL AND fecha_vencimiento <= CURRENT_DATE/);
  assert.deepEqual(calls[3].params, ["1054.69", 3]);
  assert.match(calls[5].sql, /WHERE c\.usuario_id = \?/);
  assert.deepEqual(calls[5].params, [42]);
  const movement = calls.find(({ sql }) => sql.includes("INSERT INTO movimientos"));
  assert.deepEqual(movement.params, [3, "1029.59", "1054.69", 8]);
  assert.deepEqual(response.body[0], {
    id: 8,
    cuenta_id: 3,
    monto_invertido: "1000.00",
    tasa_nominal_anual: "36.00",
    dias: 30,
    estado: "finalizado",
    liquidado_at: "2026-11-15T14:32:50.000Z",
    interes_estimado: "29.59",
    monto_al_vencimiento: "1029.59",
  });
});

test("POST /plazos-fijos/:id/cancelar pasa la clave, operación y usuario al ejecutor idempotente", async () => {
  const response = await invoke(routeHandler(fixedDepositsRouter, "post", "/:id/cancelar"), {
    params: { id: "4" },
    user: { id: 42 },
    get: (name) => name === "Idempotency-Key" ? "cancel-key" : undefined,
  });

  assert.deepEqual(response.body, { id: 4, estado: "cancelado" });
  assert.equal(idempotentOptions.userId, 42);
  assert.equal(idempotentOptions.operation, "plazos-fijos.cancelar");
  assert.equal(idempotentOptions.key, "cancel-key");
  assert.deepEqual(idempotentOptions.payload, { plazo_fijo_id: 4 });
});

test("PATCH /auth/me no permite cambiar el alias antes de 30 días", async () => {
  const calls = [];
  transactionWork = async (work) => work({
    async query(sql, params) {
      calls.push({ sql, params });
      return [[{
        id: 42,
        alias: "Alias anterior",
        alias_change_allowed: 0,
      }]];
    },
  });

  await assert.rejects(
    invoke(routeHandler(authRouter, "patch", "/me"), {
      user: { id: 42 },
      body: { alias: "Alias nuevo" },
    }),
    (error) => error.status === 429
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /alias_updated_at <= DATE_SUB\(UTC_TIMESTAMP\(\), INTERVAL 30 DAY\)/);
});

test("PATCH /auth/me actualiza alias y fecha de cambio cuando se permite", async () => {
  const calls = [];
  transactionWork = async (work) => work({
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("alias_change_allowed")) {
        return [[{ id: 42, alias: "Alias anterior", alias_change_allowed: 1 }]];
      }
      if (sql.startsWith("UPDATE usuarios SET alias")) return [{}];
      return [[{ id: 42, alias: "Alias nuevo", alias_updated_at: "2026-11-15T00:00:00.000Z" }]];
    },
  });

  const response = await invoke(routeHandler(authRouter, "patch", "/me"), {
    user: { id: 42 },
    body: { alias: " Alias nuevo " },
  });

  assert.deepEqual(response.body.usuario, {
    id: 42,
    alias: "Alias nuevo",
    alias_updated_at: "2026-11-15T00:00:00.000Z",
  });
  const update = calls.find(({ sql }) => sql.startsWith("UPDATE usuarios SET alias"));
  assert.deepEqual(update.params, ["Alias nuevo", 42]);
});

test("PATCH /auth/me rechaza entradas inválidas antes de abrir la transacción", async () => {
  let transactions = 0;
  transactionWork = async (work) => {
    transactions += 1;
    return work({ query: async () => [[]] });
  };

  for (const body of [
    { alias: "A" },
    { alias: "x".repeat(31) },
    { alias: "Alias!" },
    { avatar_url: "javascript:alert(1)" },
    { nombre: "No editable" },
    {},
  ]) {
    await assert.rejects(
      invoke(routeHandler(authRouter, "patch", "/me"), { user: { id: 42 }, body }),
      (error) => error.status === 400
    );
  }
  assert.equal(transactions, 0);
});

test("PATCH /auth/me permite guardar el mismo alias y cambiar avatar durante el período de espera", async () => {
  const calls = [];
  transactionWork = async (work) => work({
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("alias_change_allowed")) {
        return [[{ id: 42, alias: "Alias actual", alias_change_allowed: 0 }]];
      }
      if (sql.startsWith("UPDATE usuarios SET avatar_url")) return [{}];
      return [[{
        id: 42,
        alias: "Alias actual",
        alias_updated_at: "2026-11-01T00:00:00.000Z",
        avatar_url: "https://example.test/avatar.png",
      }]];
    },
  });

  const response = await invoke(routeHandler(authRouter, "patch", "/me"), {
    user: { id: 42 },
    body: { alias: "Alias actual", avatar_url: "https://example.test/avatar.png" },
  });

  assert.equal(response.body.usuario.avatar_url, "https://example.test/avatar.png");
  assert.equal(calls.some(({ sql }) => sql.startsWith("UPDATE usuarios SET alias")), false);
  assert.deepEqual(
    calls.find(({ sql }) => sql.startsWith("UPDATE usuarios SET avatar_url")).params,
    ["https://example.test/avatar.png", 42]
  );
});
