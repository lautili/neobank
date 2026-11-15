const test = require("node:test");
const assert = require("node:assert/strict");
const {
  cancelFixedDeposit,
  includeMaturityEstimate,
  settleMaturedFixedDeposits,
} = require("../src/fixedDeposits");

function fakeConnection({ deposit, balance = "25.10" }) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("SELECT p.id")) return [[deposit]];
      if (sql.includes("SELECT id, saldo FROM cuentas")) return [[{ id: deposit.cuenta_id, saldo: balance }]];
      if (sql.startsWith("UPDATE plazos_fijos")) return [{ affectedRows: 1 }];
      return [{}];
    },
  };
}

test("calcula en servidor el interés estimado y el monto al vencimiento", () => {
  const result = includeMaturityEstimate({
    id: 8,
    monto_invertido: "1000.00",
    tasa_nominal_anual: "36.00",
    dias: 30,
  });
  assert.equal(result.interes_estimado, "29.59");
  assert.equal(result.monto_al_vencimiento, "1029.59");
});

test("cancela el plazo activo y devuelve solamente el capital en una operación atómica", async () => {
  const connection = fakeConnection({
    deposit: { id: 4, cuenta_id: 9, monto_invertido: "100.25", estado: "activo", vencido: 0 },
  });
  const result = await cancelFixedDeposit(connection, { depositId: 4, userId: 12 });
  assert.deepEqual(result, {
    id: 4,
    cuenta_id: 9,
    estado: "cancelado",
    monto_devuelto: "100.25",
    saldo_resultante: "125.35",
  });
  assert.match(connection.calls[0].sql, /c\.usuario_id = \? FOR UPDATE/);
  assert.match(connection.calls[1].sql, /FOR UPDATE/);
  assert.ok(connection.calls.some(({ sql }) => sql.includes("UPDATE plazos_fijos SET estado = 'cancelado'")));
  const movement = connection.calls.find(({ sql }) => sql.includes("INSERT INTO movimientos"));
  assert.match(movement.sql, /'plazo_fijo_cancelado'/);
  assert.deepEqual(movement.params, [9, "100.25", "125.35", 4]);
  const statusUpdate = connection.calls.findIndex(({ sql }) => sql.includes("UPDATE plazos_fijos SET estado"));
  const balanceUpdate = connection.calls.findIndex(({ sql }) => sql.startsWith("UPDATE cuentas SET saldo"));
  const movementInsert = connection.calls.findIndex(({ sql }) => sql.includes("INSERT INTO movimientos"));
  assert.ok(statusUpdate < balanceUpdate && balanceUpdate < movementInsert);
});

test("rechaza plazos vencidos o finalizados sin modificar cuenta ni generar movimientos", async () => {
  for (const deposit of [
    { id: 4, cuenta_id: 9, monto_invertido: "100.25", estado: "activo", vencido: 1 },
    { id: 4, cuenta_id: 9, monto_invertido: "100.25", estado: "finalizado", vencido: 0 },
  ]) {
    const connection = fakeConnection({ deposit });
    await assert.rejects(
      cancelFixedDeposit(connection, { depositId: 4, userId: 12 }),
      (error) => error.status === 409
    );
    assert.equal(connection.calls.length, 1);
  }
});

test("no permite cancelar un plazo que no pertenece al usuario autenticado", async () => {
  const calls = [];
  const connection = {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return [[]];
    },
  };

  await assert.rejects(
    cancelFixedDeposit(connection, { depositId: 4, userId: 12 }),
    (error) => error.status === 404
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /JOIN cuentas c ON c\.id = p\.cuenta_id/);
  assert.match(calls[0].sql, /WHERE p\.id = \? AND c\.usuario_id = \? FOR UPDATE/);
  assert.deepEqual(calls[0].params, [4, 12]);
});

test("un saldo fuera de límite no modifica el plazo, la cuenta ni los movimientos", async () => {
  const calls = [];
  const connection = {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("SELECT p.id")) {
        return [[{ id: 4, cuenta_id: 9, monto_invertido: "100.25", estado: "activo", vencido: 0 }]];
      }
      if (sql.includes("SELECT id, saldo FROM cuentas")) {
        return [[{ id: 9, saldo: "9999999999.99" }]];
      }
      return [{}];
    },
  };

  await assert.rejects(
    cancelFixedDeposit(connection, { depositId: 4, userId: 12 }),
    (error) => error.status === 400
  );
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ sql }) => !sql.startsWith("UPDATE") && !sql.includes("INSERT INTO movimientos")));
});

function settlementConnection({ deposits, balance = "25.10" }) {
  const calls = [];
  const states = new Map(deposits.map((deposit) => [deposit.id, deposit.estado || "activo"]));
  const liquidatedAt = new Map(deposits.map((deposit) => [deposit.id, deposit.liquidado_at || null]));
  let currentBalance = balance;
  return {
    calls,
    states,
    liquidatedAt,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("SELECT p.id, p.cuenta_id")) {
        return [deposits.filter((deposit) =>
          ["activo", "finalizado"].includes(states.get(deposit.id))
          && liquidatedAt.get(deposit.id) == null
        )];
      }
      if (sql.startsWith("SELECT id, saldo FROM cuentas")) {
        return [[{ id: params[0], saldo: currentBalance }]];
      }
      if (sql.startsWith("UPDATE plazos_fijos")) {
        states.set(params[0], "finalizado");
        liquidatedAt.set(params[0], "2026-11-15 14:32:50");
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("UPDATE cuentas SET saldo")) {
        currentBalance = params[0];
        return [{}];
      }
      return [{}];
    },
  };
}

test("liquida el total vencido y registra bloqueos, estado y movimiento en orden", async () => {
  const connection = settlementConnection({
    deposits: [{
      id: 8,
      cuenta_id: 3,
      monto_invertido: "1000.00",
      tasa_nominal_anual: "36.00",
      dias: 30,
    }],
  });

  assert.equal(await settleMaturedFixedDeposits(connection, 42), 1);
  const selection = connection.calls[0];
  assert.match(selection.sql, /c\.usuario_id = \? AND p\.estado IN \('activo', 'finalizado'\)/);
  assert.match(selection.sql, /p\.liquidado_at IS NULL AND p\.fecha_vencimiento <= CURRENT_DATE/);
  assert.match(selection.sql, /FOR UPDATE/);
  assert.deepEqual(selection.params, [42]);

  const accountLock = connection.calls.find(({ sql }) => sql.startsWith("SELECT id, saldo FROM cuentas"));
  assert.match(accountLock.sql, /FOR UPDATE/);
  assert.deepEqual(accountLock.params, [3, 42]);

  const stateUpdate = connection.calls.find(({ sql }) => sql.startsWith("UPDATE plazos_fijos"));
  assert.match(stateUpdate.sql, /estado = 'finalizado'/);
  assert.match(stateUpdate.sql, /liquidado_at = UTC_TIMESTAMP\(\)/);
  assert.match(stateUpdate.sql, /WHERE id = \? AND estado IN \('activo', 'finalizado'\)/);
  assert.match(stateUpdate.sql, /liquidado_at IS NULL AND fecha_vencimiento <= CURRENT_DATE/);
  assert.deepEqual(stateUpdate.params, [8]);

  const balanceUpdate = connection.calls.find(({ sql }) => sql.startsWith("UPDATE cuentas SET saldo"));
  assert.deepEqual(balanceUpdate.params, ["1054.69", 3]);
  const movement = connection.calls.find(({ sql }) => sql.includes("INSERT INTO movimientos"));
  assert.match(movement.sql, /'plazo_fijo_vencido'/);
  assert.deepEqual(movement.params, [3, "1029.59", "1054.69", 8]);

  const stateIndex = connection.calls.indexOf(stateUpdate);
  const balanceIndex = connection.calls.indexOf(balanceUpdate);
  const movementIndex = connection.calls.indexOf(movement);
  assert.ok(stateIndex < balanceIndex && balanceIndex < movementIndex);
});

test("sin vencidos no modifica nada y repetir la liquidación no duplica el crédito ni el movimiento", async () => {
  const connection = settlementConnection({
    deposits: [{
      id: 8,
      cuenta_id: 3,
      monto_invertido: "1000.00",
      tasa_nominal_anual: "36.00",
      dias: 30,
    }],
  });

  assert.equal(await settleMaturedFixedDeposits(connection, 42), 1);
  assert.equal(await settleMaturedFixedDeposits(connection, 42), 0);
  assert.equal(connection.states.get(8), "finalizado");
  assert.equal(connection.calls.filter(({ sql }) => sql.startsWith("UPDATE cuentas SET saldo")).length, 1);
  assert.equal(connection.calls.filter(({ sql }) => sql.includes("INSERT INTO movimientos")).length, 1);
  assert.equal(connection.calls.filter(({ sql }) => sql.startsWith("UPDATE plazos_fijos")).length, 1);

  const emptyConnection = settlementConnection({ deposits: [] });
  assert.equal(await settleMaturedFixedDeposits(emptyConnection, 42), 0);
  assert.equal(emptyConnection.calls.length, 1);
});

test("liquida un plazo legacy finalizado sin liquidado_at y el reintento no duplica el crédito", async () => {
  const connection = settlementConnection({
    deposits: [{
      id: 8,
      cuenta_id: 3,
      monto_invertido: "1000.00",
      tasa_nominal_anual: "36.00",
      dias: 30,
      estado: "finalizado",
      liquidado_at: null,
    }],
  });

  assert.equal(await settleMaturedFixedDeposits(connection, 42), 1);
  assert.equal(connection.states.get(8), "finalizado");
  assert.equal(connection.liquidatedAt.get(8), "2026-11-15 14:32:50");
  assert.equal(await settleMaturedFixedDeposits(connection, 42), 0);
  assert.equal(connection.calls.filter(({ sql }) => sql.startsWith("UPDATE cuentas SET saldo")).length, 1);
  assert.equal(connection.calls.filter(({ sql }) => sql.includes("INSERT INTO movimientos")).length, 1);
  assert.equal(connection.calls.filter(({ sql }) => sql.startsWith("UPDATE plazos_fijos")).length, 1);
  assert.equal(connection.calls.filter(({ sql }) => sql.includes("SELECT p.id, p.cuenta_id")).length, 2);
});

test("rechaza un saldo que excedería el máximo sin cambiar el estado ni registrar movimientos", async () => {
  const connection = settlementConnection({
    deposits: [{
      id: 8,
      cuenta_id: 3,
      monto_invertido: "1000.00",
      tasa_nominal_anual: "36.00",
      dias: 30,
    }],
    balance: "9999999999.99",
  });

  await assert.rejects(
    settleMaturedFixedDeposits(connection, 42),
    (error) => error.status === 409
      && error.message === "El saldo no admite acreditar el total del plazo fijo vencido"
  );
  assert.equal(connection.states.get(8), "activo");
  assert.equal(connection.calls.length, 2);
  assert.ok(connection.calls.every(({ sql }) => !sql.startsWith("UPDATE") && !sql.includes("INSERT INTO movimientos")));
});
