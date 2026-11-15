function createTransactionRunner(databasePool) {
  return async function withTransaction(work) {
    const connection = await databasePool.getConnection();
    let transactionStarted = false;
    let reusable = true;
    try {
      await connection.beginTransaction();
      transactionStarted = true;
      const result = await work(connection);
      try {
        await connection.commit();
      } catch (error) {
        reusable = false;
        connection.destroy();
        console.error(error.code || "TRANSACTION_COMMIT_UNKNOWN");
        const outcomeError = new Error("No se pudo confirmar el resultado de la operación");
        outcomeError.status = 503;
        outcomeError.code = "TRANSACTION_COMMIT_UNKNOWN";
        throw outcomeError;
      }
      return result;
    } catch (error) {
      if (transactionStarted && reusable) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          reusable = false;
          connection.destroy();
          console.error(rollbackError.code || "TRANSACTION_ROLLBACK_FAILED");
          const rollbackFailure = new Error("No se pudo completar la operación de forma segura");
          rollbackFailure.status = 503;
          rollbackFailure.code = "TRANSACTION_ROLLBACK_FAILED";
          throw rollbackFailure;
        }
      }
      throw error;
    } finally {
      if (reusable) connection.release();
    }
  };
}

module.exports = { createTransactionRunner };
