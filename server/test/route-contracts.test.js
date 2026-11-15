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
let idempotentRunner;
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
    if (idempotentRunner) return idempotentRunner(options);
    return { result: { id: options.payload.plazo_fijo_id, estado: "cancelado" } };
  },
};
require.cache[dbPath] = dbModule;
require.cache[authMiddlewarePath] = authMiddlewareModule;
require.cache[idempotencyPath] = idempotencyModule;

const authRouter = require("../src/routes/auth");
const accountsRouter = require("../src/routes/cuentas");
const transfersRouter = require("../src/routes/transferencias");
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
      if (sql.startsWith("SELECT id, usuario_id, cbu, cvu, alias, alias_updated_at, saldo, moneda, created_at FROM cuentas")) {
        return [[{
          id: 3,
          usuario_id: 42,
          cbu: "123",
          cvu: "456",
          alias: null,
          alias_updated_at: null,
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
    alias: null,
    alias_updated_at: null,
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
    sql.startsWith("SELECT id, usuario_id, cbu, cvu, alias, alias_updated_at, saldo, moneda, created_at FROM cuentas")
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

test("PATCH /auth/me solo permite actualizar el avatar y rechaza el alias", async () => {
  let transactions = 0;
  transactionWork = async (work) => {
    transactions += 1;
    return work({
      async query(sql) {
        if (sql.includes("FOR UPDATE")) return [[{ id: 42, avatar_url: null }]];
        if (sql.startsWith("UPDATE usuarios SET avatar_url")) return [{}];
        return [[{
          id: 42,
          nombre: "Ana",
          apellido: "Pérez",
          email: "ana@example.test",
          dni: "12345678",
          avatar_url: "https://example.test/avatar.png",
        }]];
      },
    });
  };

  const response = await invoke(routeHandler(authRouter, "patch", "/me"), {
    user: { id: 42 },
    body: { avatar_url: "https://example.test/avatar.png" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.usuario.avatar_url, "https://example.test/avatar.png");
  assert.equal(Object.hasOwn(response.body.usuario, "alias"), false);
  assert.equal(transactions, 1);

  for (const body of [
    { alias: "AliasNuevo" },
    { avatar_url: "javascript:alert(1)" },
    { nombre: "No editable" },
    {},
  ]) {
    await assert.rejects(
      invoke(routeHandler(authRouter, "patch", "/me"), { user: { id: 42 }, body }),
      (error) => error.status === 400
    );
  }
  assert.equal(transactions, 1, "las solicitudes inválidas no deben abrir transacciones");
});

test("GET /auth/me no expone alias", async () => {
  poolQuery = async (sql, params) => {
    assert.match(sql, /SELECT id, nombre, apellido, email, dni, avatar_url\s+FROM usuarios WHERE id = \?/);
    assert.deepEqual(params, [42]);
    return [[{
      id: 42,
      nombre: "Ana",
      apellido: "Pérez",
      email: "ana@example.test",
      dni: "12345678",
      avatar_url: null,
    }]];
  };
  const response = await invoke(routeHandler(authRouter, "get", "/me"), { user: { id: 42 } });
  assert.equal(response.status, 200);
  assert.equal(Object.hasOwn(response.body.usuario, "alias"), false);
});

function accountRow(overrides = {}) {
  return {
    id: 9,
    usuario_id: 42,
    cbu: "1".repeat(22),
    cvu: "2".repeat(22),
    alias: "antes01",
    alias_updated_at: null,
    saldo: "100.00",
    moneda: "ARS",
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("PATCH /cuentas/:id/alias valida formato y normaliza alias antes de la transacción", async () => {
  let transactions = 0;
  transactionWork = async (work) => {
    transactions += 1;
    return work({ query: async () => [[]] });
  };

  for (const alias of [
    "abcde",
    "a".repeat(31),
    "abc de1",
    "abc!de",
    " abcde",
    "ábcdef",
    123456,
  ]) {
    await assert.rejects(
      invoke(routeHandler(accountsRouter, "patch", "/:id/alias"), {
        params: { id: "9" },
        user: { id: 42 },
        body: { alias },
      }),
      (error) => error.status === 400
    );
  }
  assert.equal(transactions, 0);

  const calls = [];
  transactionWork = async (work) => work({
    async query(sql, params) {
      calls.push({ sql, params });
      if (calls.length === 1) return [[accountRow({ alias_change_allowed: 1 })]];
      if (sql.startsWith("UPDATE cuentas SET alias")) return [{}];
      return [[accountRow({ alias: "abcde1", alias_updated_at: "2026-11-15T00:00:00.000Z" })]];
    },
  });
  const response = await invoke(routeHandler(accountsRouter, "patch", "/:id/alias"), {
    params: { id: "9" },
    user: { id: 42 },
    body: { alias: "ABCDE1" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    cuenta: accountRow({ alias: "abcde1", alias_updated_at: "2026-11-15T00:00:00.000Z" }),
  });
  assert.match(calls[0].sql, /FOR UPDATE/);
  assert.deepEqual(calls[0].params, [9, 42]);
  assert.deepEqual(calls[1].params, ["abcde1", 9]);
});

test("PATCH /cuentas/:id/alias verifica ownership con 404", async () => {
  const calls = [];
  let lockingSql;
  transactionWork = async (work) => work({
    async query(sql, params) {
      calls.push({ sql, params });
      lockingSql = { sql, params };
      return [[]];
    },
  });
  await assert.rejects(
    invoke(routeHandler(accountsRouter, "patch", "/:id/alias"), {
      params: { id: "9" },
      user: { id: 7 },
      body: { alias: "nuevo01" },
    }),
    (error) => error.status === 404
  );
  assert.match(lockingSql.sql, /WHERE id = \? AND usuario_id = \? FOR UPDATE/);
  assert.deepEqual(lockingSql.params, [9, 7]);
  assert.equal(calls.length, 1);
});

test("PATCH /cuentas/:id/alias devuelve 429 durante cooldown y bloquea la fila", async () => {
  const calls = [];
  transactionWork = async (work) => work({
    async query(sql, params) {
      calls.push({ sql, params });
      return [[accountRow({ alias_updated_at: "2026-11-01T00:00:00.000Z", alias_change_allowed: 0 })]];
    },
  });
  await assert.rejects(
    invoke(routeHandler(accountsRouter, "patch", "/:id/alias"), {
      params: { id: "9" },
      user: { id: 42 },
      body: { alias: "nuevo01" },
    }),
    (error) => error.status === 429
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /alias_updated_at <= DATE_SUB\(UTC_TIMESTAMP\(\), INTERVAL 30 DAY\)/);
  assert.match(calls[0].sql, /FOR UPDATE/);
});

test("PATCH /cuentas/:id/alias convierte alias duplicado a 409", async () => {
  const calls = [];
  transactionWork = async (work) => work({
    async query(sql, params) {
      calls.push({ sql, params });
      if (calls.length === 1) return [[accountRow({ alias_change_allowed: 1 })]];
      const error = new Error("duplicate");
      error.code = "ER_DUP_ENTRY";
      throw error;
    },
  });
  await assert.rejects(
    invoke(routeHandler(accountsRouter, "patch", "/:id/alias"), {
      params: { id: "9" },
      user: { id: 42 },
      body: { alias: "duplicado" },
    }),
    (error) => error.status === 409
  );
  assert.equal(calls.length, 2);
});

test("PATCH /cuentas/:id/alias acepta 30 caracteres y los símbolos permitidos", async () => {
  const alias = `A._-${"B".repeat(26)}`;
  const normalizedAlias = alias.toLowerCase();
  let queryCount = 0;
  transactionWork = async (work) => work({
    async query(sql) {
      queryCount += 1;
      if (queryCount === 1) return [[accountRow({ alias_change_allowed: 1 })]];
      if (sql.startsWith("UPDATE cuentas SET alias")) return [{}];
      return [[accountRow({ alias: normalizedAlias })]];
    },
  });
  const response = await invoke(routeHandler(accountsRouter, "patch", "/:id/alias"), {
    params: { id: "9" },
    user: { id: 42 },
    body: { alias },
  });
  assert.equal(response.body.cuenta.alias, normalizedAlias);
  assert.equal(alias.length, 30);
});

async function postTransfer(destino, {
  selectedDestination = 11,
  lockedDestinationAlias = destino,
  calls = [],
} = {}) {
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith("SELECT id FROM cuentas WHERE id = ? AND usuario_id")) return [[{ id: 8 }]];
      if (sql.includes("FROM cuentas WHERE cbu = ? OR cvu = ?")) {
        return [[{ id: selectedDestination }]];
      }
      if (sql.includes("FROM cuentas WHERE alias = ?")) return [[{ id: selectedDestination }]];
      if (sql.includes("SELECT id, saldo, moneda, alias FROM cuentas")) {
        return [[
          { id: 8, saldo: "100.00", moneda: "ARS", alias: null },
          {
            id: selectedDestination,
            saldo: "0.00",
            moneda: "ARS",
            alias: destino.match(/^\d{22}$/) ? null : lockedDestinationAlias,
          },
        ]];
      }
      if (sql.startsWith("INSERT INTO transferencias")) return [{ insertId: 99 }];
      return [{}];
    },
  };
  idempotentRunner = async (options) => ({
    result: await options.work(connection),
  });
  const response = await invoke(routeHandler(transfersRouter, "post", "/"), {
    user: { id: 42 },
    body: { cuenta_origen_id: 8, destino, monto: "10.00", descripcion: "" },
    get: (name) => name === "Idempotency-Key" ? "transfer-test-key" : undefined,
  });
  return { calls, response };
}

test("POST /transferencias acepta CBU/CVU de 22 dígitos y busca por ambos campos", async () => {
  const destino = "3".repeat(22);
  const { calls, response } = await postTransfer(destino);
  assert.equal(response.status, 201);
  assert.equal(response.body.destino_tipo, "cbu_cvu");
  assert.deepEqual(response.body.destino, destino);
  const lookup = calls.find(({ sql }) => sql.includes("FROM cuentas WHERE cbu = ? OR cvu = ?"));
  assert.deepEqual(lookup.params, [destino, destino]);
});

test("POST /transferencias normaliza alias para resolverlo sin distinguir mayúsculas", async () => {
  const { calls, response } = await postTransfer("Mi.Alias-1");
  assert.equal(response.status, 201);
  assert.equal(response.body.destino_tipo, "alias");
  assert.equal(response.body.destino, "mi.alias-1");
  const lookup = calls.find(({ sql }) => sql.includes("FROM cuentas WHERE alias = ?"));
  assert.deepEqual(lookup.params, ["mi.alias-1"]);
  const lockingQuery = calls.find(({ sql }) => sql.includes("FOR UPDATE"));
  assert.match(lockingQuery.sql, /SELECT id, saldo, moneda, alias FROM cuentas/);
});

test("POST /transferencias rechaza alias que ya no pertenece al destino bloqueado", async () => {
  const calls = [];
  await assert.rejects(
    postTransfer("Mi.Alias-1", { lockedDestinationAlias: "otro.alias", calls }),
    (error) => error.status === 404
  );
  assert.equal(calls.some(({ sql }) => sql.startsWith("UPDATE cuentas")), false);
  assert.equal(calls.some(({ sql }) => sql.startsWith("INSERT INTO transferencias")), false);
});

test("POST /transferencias rechaza destinos que no sean CBU/CVU ni alias", async () => {
  idempotentRunner = async () => {
    throw new Error("No debe iniciar la operación");
  };
  await assert.rejects(
    invoke(routeHandler(transfersRouter, "post", "/"), {
      user: { id: 42 },
      body: { cuenta_origen_id: 8, destino: "12345", monto: "1.00" },
      get: () => "transfer-invalid-key",
    }),
    (error) => error.status === 400
  );
});
