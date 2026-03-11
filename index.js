const http = require("http");
const express = require("express");
const RED = require("node-red");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);

// ====== CREDENCIALES DEL EDITOR ======
const ADMIN_USER = "fmadmin";
const ADMIN_PASS = "ClaveTemporal123!";

// ====== BASIC AUTH SOLO PARA EL EDITOR ======
function basicAuth(req, res, next) {
  const auth = req.headers.authorization || "";

  if (!auth.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Node-RED Admin"');
    return res.status(401).send("Autenticacion requerida");
  }

  const base64Credentials = auth.split(" ")[1];
  const credentials = Buffer.from(base64Credentials, "base64").toString("utf8");
  const [user, pass] = credentials.split(":");

  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    return next();
  }

  res.setHeader("WWW-Authenticate", 'Basic realm="Node-RED Admin"');
  return res.status(401).send("Credenciales invalidas");
}

const settings = {
  httpAdminRoot: "/admin",
  httpNodeRoot: "/",
  userDir: "/opt/render/project/src/.nodered",
  functionGlobalContext: {},

  httpNodeCors: {
    origin: "*",
    methods: "GET,PUT,POST,DELETE,OPTIONS",
    allowedHeaders: "Content-Type, Authorization"
  }
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function probarPostgres() {
  try {
    const result = await pool.query("SELECT NOW() as fecha");
    console.log("PostgreSQL conectado OK:", result.rows[0].fecha);
  } catch (error) {
    console.error("Error conectando a PostgreSQL:", error.message);
  }
}

async function crearTablaSiNoExiste() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS power_readings (
        id BIGSERIAL PRIMARY KEY,
        device_id TEXT NOT NULL,
        voltage_an NUMERIC(10,3),
        voltage_bn NUMERIC(10,3),
        voltage_cn NUMERIC(10,3),
        current_a NUMERIC(10,3),
        current_b NUMERIC(10,3),
        current_c NUMERIC(10,3),
        frequency NUMERIC(10,3),
        power_total NUMERIC(12,3),
        energy_total NUMERIC(12,3),
        raw_payload JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    console.log("Tabla power_readings lista");
  } catch (error) {
    console.error("Error creando tabla:", error.message);
  }
}

RED.init(server, settings);

// Editor protegido
app.use("/admin", basicAuth, RED.httpAdmin);

// Endpoints HTTP publicos
app.use("/", RED.httpNode);

async function iniciar() {
  await probarPostgres();
  await crearTablaSiNoExiste();
  RED.start();
}

iniciar();

const PORT = process.env.PORT || 1880;
server.listen(PORT, () => {
  console.log("Node-RED corriendo en puerto " + PORT);
  console.log("Editor en /admin");
});
