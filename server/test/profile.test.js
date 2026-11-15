const test = require("node:test");
const assert = require("node:assert/strict");
const { parseProfilePatch } = require("../src/profile");

test("valida y normaliza campos editables del perfil", () => {
  assert.deepEqual(parseProfilePatch({ alias: "  Ana Pérez  ", avatar_url: "https://example.test/a.png" }), {
    alias: "Ana Pérez",
    avatar_url: "https://example.test/a.png",
  });
  assert.deepEqual(parseProfilePatch({ alias: "x".repeat(30) }), { alias: "x".repeat(30) });
  assert.deepEqual(parseProfilePatch({ avatar_url: null }), { avatar_url: null });
  assert.deepEqual(parseProfilePatch({ alias: null }), { alias: null });
});

test("rechaza alias fuera de límites, URLs no web y campos no autorizados", () => {
  assert.equal(parseProfilePatch({ alias: "A" }), null);
  assert.equal(parseProfilePatch({ alias: "x".repeat(31) }), null);
  assert.equal(parseProfilePatch({ alias: " Alias!" }), null);
  assert.equal(parseProfilePatch({ alias: 123 }), null);
  assert.equal(parseProfilePatch({ alias: ["Ana"] }), null);
  assert.equal(parseProfilePatch({ avatar_url: "javascript:alert(1)" }), null);
  assert.equal(parseProfilePatch({ avatar_url: "https://user:pass@example.test/a" }), null);
  assert.equal(parseProfilePatch({ avatar_url: "https://user:pass@example.test/a" }), null);
  assert.equal(parseProfilePatch({ avatar_url: "x".repeat(2049) }), null);
  assert.equal(parseProfilePatch(null), null);
  assert.equal(parseProfilePatch([]), null);
  assert.equal(parseProfilePatch({ nombre: "Otro" }), null);
  assert.equal(parseProfilePatch({}), null);
});
