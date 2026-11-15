const { httpError } = require("./errors");
const { calcularPlazoFijo, parseEntero, parseTasa } = require("./finance");
const { addCentsWithinLimit, centsToDecimal, parseMoney } = require("./money");

function includeMaturityEstimate(plazo) {
  const monto = parseMoney(plazo.monto_invertido);
  const tasa = parseTasa(plazo.tasa_nominal_anual);
  const dias = parseEntero(plazo.dias, 1, 365);
  if (monto == null || tasa == null || dias == null) throw httpError(500, "Error interno");
  const calculo = calcularPlazoFijo(monto, tasa, dias);
  return {
    ...plazo,
    interes_estimado: calculo.interes,
    monto_al_vencimiento: calculo.monto_al_vencimiento,
  };
}

async function settleMaturedFixedDeposits(connection, userId) {
  const [deposits] = await connection.query(
    `SELECT p.id, p.cuenta_id, p.monto_invertido, p.tasa_nominal_anual, p.dias
     FROM plazos_fijos p
     JOIN cuentas c ON c.id = p.cuenta_id
     WHERE c.usuario_id = ? AND p.estado IN ('activo', 'finalizado')
       AND p.liquidado_at IS NULL AND p.fecha_vencimiento <= CURRENT_DATE
     ORDER BY p.id
     FOR UPDATE`,
    [userId]
  );

  for (const deposit of deposits) {
    const [accounts] = await connection.query(
      "SELECT id, saldo FROM cuentas WHERE id = ? AND usuario_id = ? FOR UPDATE",
      [deposit.cuenta_id, userId]
    );
    if (!accounts.length) throw httpError(404, "Cuenta no encontrada");

    const saldo = parseMoney(accounts[0].saldo, { allowZero: true });
    const capital = parseMoney(deposit.monto_invertido);
    const tasa = parseTasa(deposit.tasa_nominal_anual);
    const dias = parseEntero(deposit.dias, 1, 365);
    if (saldo == null || capital == null || tasa == null || dias == null) {
      throw httpError(500, "Error interno");
    }

    const estimacion = calcularPlazoFijo(capital, tasa, dias);
    const total = parseMoney(estimacion.monto_al_vencimiento);
    const saldoResultante = total == null ? null : addCentsWithinLimit(saldo, total);
    if (saldoResultante == null) {
      throw httpError(409, "El saldo no admite acreditar el total del plazo fijo vencido");
    }

    const [updated] = await connection.query(
      `UPDATE plazos_fijos SET estado = 'finalizado', liquidado_at = UTC_TIMESTAMP()
       WHERE id = ? AND estado IN ('activo', 'finalizado')
         AND liquidado_at IS NULL AND fecha_vencimiento <= CURRENT_DATE`,
      [deposit.id]
    );
    if (updated.affectedRows !== 1) {
      throw httpError(409, "El plazo fijo ya no está disponible para liquidación");
    }

    const saldoDecimal = centsToDecimal(saldoResultante);
    const montoAcreditado = centsToDecimal(total);
    await connection.query("UPDATE cuentas SET saldo = ? WHERE id = ?", [saldoDecimal, deposit.cuenta_id]);
    await connection.query(
      `INSERT INTO movimientos (cuenta_id, tipo, monto, saldo_resultante, referencia_id)
       VALUES (?, 'plazo_fijo_vencido', ?, ?, ?)`,
      [deposit.cuenta_id, montoAcreditado, saldoDecimal, deposit.id]
    );
  }

  return deposits.length;
}

async function cancelFixedDeposit(connection, { depositId, userId }) {
  const [deposits] = await connection.query(
    `SELECT p.id, p.cuenta_id, p.monto_invertido, p.estado,
            (p.fecha_vencimiento <= CURRENT_DATE) AS vencido
     FROM plazos_fijos p
     JOIN cuentas c ON c.id = p.cuenta_id
     WHERE p.id = ? AND c.usuario_id = ? FOR UPDATE`,
    [depositId, userId]
  );
  if (!deposits.length) throw httpError(404, "Plazo fijo no encontrado");

  const deposit = deposits[0];
  if (deposit.estado !== "activo") throw httpError(409, "El plazo fijo ya no está activo");
  if (deposit.vencido) throw httpError(409, "No se puede cancelar un plazo fijo vencido");

  const [accounts] = await connection.query(
    "SELECT id, saldo FROM cuentas WHERE id = ? AND usuario_id = ? FOR UPDATE",
    [deposit.cuenta_id, userId]
  );
  if (!accounts.length) throw httpError(404, "Cuenta no encontrada");

  const saldo = parseMoney(accounts[0].saldo, { allowZero: true });
  const capital = parseMoney(deposit.monto_invertido);
  if (saldo == null || capital == null) throw httpError(500, "Error interno");
  const saldoResultante = addCentsWithinLimit(saldo, capital);
  if (saldoResultante == null) {
    throw httpError(400, "El saldo resultante excede el máximo permitido");
  }

  const [updated] = await connection.query(
    "UPDATE plazos_fijos SET estado = 'cancelado' WHERE id = ? AND estado = 'activo'",
    [depositId]
  );
  if (updated.affectedRows !== 1) throw httpError(409, "El plazo fijo ya no está activo");

  const montoDevuelto = centsToDecimal(capital);
  const saldoDecimal = centsToDecimal(saldoResultante);
  await connection.query("UPDATE cuentas SET saldo = ? WHERE id = ?", [saldoDecimal, deposit.cuenta_id]);
  await connection.query(
    `INSERT INTO movimientos (cuenta_id, tipo, monto, saldo_resultante, referencia_id)
     VALUES (?, 'plazo_fijo_cancelado', ?, ?, ?)`,
    [deposit.cuenta_id, montoDevuelto, saldoDecimal, depositId]
  );

  return {
    id: depositId,
    cuenta_id: deposit.cuenta_id,
    estado: "cancelado",
    monto_devuelto: montoDevuelto,
    saldo_resultante: saldoDecimal,
  };
}

module.exports = { cancelFixedDeposit, includeMaturityEstimate, settleMaturedFixedDeposits };
