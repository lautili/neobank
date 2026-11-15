const test = require("node:test");
const assert = require("node:assert/strict");
const { createTransactionRunner } = require("../src/transactions");

function setup({ rollbackError, commitError } = {}) {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push("begin"); },
    async commit() {
      calls.push("commit");
      if (commitError) throw commitError;
    },
    async rollback() {
      calls.push("rollback");
      if (rollbackError) throw rollbackError;
    },
    destroy() { calls.push("destroy"); },
    release() { calls.push("release"); },
  };
  return {
    calls,
    run: createTransactionRunner({ async getConnection() { return connection; } }),
  };
}

test("un fallo de rollback destruye la conexión y propaga un error seguro", async () => {
  const { calls, run } = setup({ rollbackError: Object.assign(new Error("detalle interno"), { code: "ECONNRESET" }) });
  const previousError = new Error("falló la consulta");
  await assert.rejects(run(async () => { throw previousError; }), (error) => {
    assert.equal(error.code, "TRANSACTION_ROLLBACK_FAILED");
    assert.equal(error.status, 503);
    assert.equal(error.message, "No se pudo completar la operación de forma segura");
    return true;
  });
  assert.deepEqual(calls, ["begin", "rollback", "destroy"]);
});

test("un commit incierto no se revierte ni libera al pool la conexión", async () => {
  const { calls, run } = setup({ commitError: Object.assign(new Error("detalle interno"), { code: "PROTOCOL_LOST" }) });
  await assert.rejects(run(async () => "ok"), (error) => {
    assert.equal(error.code, "TRANSACTION_COMMIT_UNKNOWN");
    assert.equal(error.status, 503);
    return true;
  });
  assert.deepEqual(calls, ["begin", "commit", "destroy"]);
});

test("un rollback exitoso conserva el error de negocio y libera la conexión", async () => {
  const { calls, run } = setup();
  const failure = Object.assign(new Error("invalid"), { status: 400 });
  await assert.rejects(run(async () => { throw failure; }), (error) => error === failure);
  assert.deepEqual(calls, ["begin", "rollback", "release"]);
});
