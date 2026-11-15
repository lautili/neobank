const test = require("node:test");
const assert = require("node:assert/strict");
const { parseProfilePatch } = require("../src/profile");

test("valida y normaliza únicamente el avatar editable del perfil", () => {
  assert.deepEqual(parseProfilePatch({ avatar_url: "  https://example.test/a.png  " }), {
    avatar_url: "https://example.test/a.png",
  });
  assert.deepEqual(parseProfilePatch({ avatar_url: null }), { avatar_url: null });
});

test("rechaza URLs no web, valores inválidos, campos no autorizados y alias", () => {
  for (const body of [
    { avatar_url: "javascript:alert(1)" },
    { avatar_url: "******example.test/a" },
    { avatar_url: "x".repeat(2049) },
    { avatar_url: 123 },
    { avatar_url: "" },
    { alias: "AliasNuevo" },
    { nombre: "Otro" },
    {},
    null,
    [],
  ]) {
    assert.equal(parseProfilePatch(body), null, `debía rechazarse ${JSON.stringify(body)}`);
  }
});
