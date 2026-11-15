export function getIdempotencyKey(requestRef, payload) {
  const serializedPayload = JSON.stringify(payload);
  if (requestRef.current?.payload === serializedPayload) {
    return requestRef.current.key;
  }

  if (!globalThis.crypto?.randomUUID) {
    throw new Error("Este navegador no permite asegurar el reintento de la operación.");
  }

  const key = globalThis.crypto.randomUUID();
  requestRef.current = { payload: serializedPayload, key };
  return key;
}
