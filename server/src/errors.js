function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function logError(error) {
  if (error.status) return;
  console.error(error.code || "APP_ERROR");
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error.type === "entity.parse.failed") {
    res.status(400).json({ error: "JSON inválido" });
    return;
  }

  logError(error);

  if (error.status) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  if (error.code === "ER_DUP_ENTRY") {
    const detail = String(error.sqlMessage || "");
    if (detail.includes("uq_usuarios_email")) {
      res.status(409).json({ error: "El email ya está registrado" });
      return;
    }
    if (detail.includes("uq_usuarios_dni")) {
      res.status(409).json({ error: "El DNI ya está registrado" });
      return;
    }
    res.status(409).json({ error: "El registro ya existe" });
    return;
  }

  res.status(500).json({ error: "Error interno" });
}

module.exports = { httpError, errorHandler };
