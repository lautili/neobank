const test = require("node:test");
const assert = require("node:assert/strict");
const { createIdempotentExecutor, validateIdempotencyKey } = require("../src/idempotency");

function fakeStorage() {
  const records = new Map();
  const database = {
    async query(sql, params) {
      assert.match(sql, /SELECT payload_hash, response_body/);
      const record = records.get(params.join(":"));
      return [record ? [record] : []];
    },
  };
  const transaction = async (work) => {
    const snapshot = new Map(records);
    const connection = {
      async query(sql, params) {
        if (sql.includes("INSERT INTO idempotency_requests")) {
          const recordKey = `${params[0]}:${params[1]}:${params[2]}`;
          if (records.has(recordKey)) {
            throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
          }
          records.set(recordKey, { payload_hash: params[3], response_body: null });
          return [{}];
        }
        assert.match(sql, /UPDATE idempotency_requests SET response_body/);
        const recordKey = `${params[1]}:${params[2]}:${params[3]}`;
        records.get(recordKey).response_body = params[0];
        return [{}];
      },
    };
    try {
      return await work(connection);
    } catch (error) {
      records.clear();
      for (const [key, record] of snapshot) records.set(key, record);
      throw error;
    }
  };
  return { database, transaction };
}

test("reintentos idénticos reproducen la respuesta sin ejecutar otra operación", async () => {
  const { database, transaction } = fakeStorage();
  const execute = createIdempotentExecutor(database, transaction);
  let calls = 0;
  const request = {
    userId: 7,
    operation: "transferencias.crear",
    key: "attempt-123",
    payload: { amountCents: 525 },
    work: async () => ({ id: ++calls, monto: "5.25" }),
  };
  const first = await execute(request);
  const retry = await execute(request);
  assert.deepEqual(first, { result: { id: 1, monto: "5.25" }, replayed: false });
  assert.deepEqual(retry, { result: { id: 1, monto: "5.25" }, replayed: true });
  assert.equal(calls, 1);
});

test("la misma clave con payload divergente falla explícitamente", async () => {
  const { database, transaction } = fakeStorage();
  const execute = createIdempotentExecutor(database, transaction);
  const request = {
    userId: 7,
    operation: "prestamos.crear",
    key: "loan-1",
    payload: { amountCents: 525 },
    work: async () => ({ id: 1 }),
  };
  await execute(request);
  await assert.rejects(
    execute({ ...request, payload: { amountCents: 526 } }),
    (error) => error.status === 409
  );
});

test("valida y acota la clave antes de usarla", () => {
  assert.equal(validateIdempotencyKey("key-1"), "key-1");
  assert.throws(() => validateIdempotencyKey(""), (error) => error.status === 400);
  assert.throws(() => validateIdempotencyKey("x".repeat(129)), (error) => error.status === 400);
});
