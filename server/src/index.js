require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { errorHandler } = require("./errors");
const authRoutes = require("./routes/auth");
const cuentasRoutes = require("./routes/cuentas");
const transferenciasRoutes = require("./routes/transferencias");
const tarjetasRoutes = require("./routes/tarjetas");
const prestamosRoutes = require("./routes/prestamos");
const plazosFijosRoutes = require("./routes/plazosFijos");

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  throw new Error("JWT_SECRET debe tener al menos 16 caracteres");
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173" }));

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.use("/api/auth", authRoutes);
app.use("/api/cuentas", cuentasRoutes);
app.use("/api/transferencias", transferenciasRoutes);
app.use("/api/tarjetas", tarjetasRoutes);
app.use("/api/prestamos", prestamosRoutes);
app.use("/api/plazos-fijos", plazosFijosRoutes);

app.use((req, res) => {
  res.status(404).json({ error: "Ruta no encontrada" });
});
app.use(errorHandler);

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`API escuchando en el puerto ${port}`);
});

module.exports = { app };
