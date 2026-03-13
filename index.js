// ============================================================
// BLOQUE 1: IMPORTACIONES
// ============================================================
const http = require("http");
const express = require("express");
const RED = require("node-red");
const { Pool } = require("pg");


// ============================================================
// BLOQUE 2: APP Y SERVIDOR BASE
// ============================================================
const app = express();
const server = http.createServer(app);

app.use(express.json());


// ============================================================
// BLOQUE 3: CORS GLOBAL PARA API Y DASHBOARD
// ============================================================
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});


// ============================================================
// BLOQUE 4: CREDENCIALES DEL EDITOR NODE-RED
// ============================================================
const ADMIN_USER = "fmadmin";
const ADMIN_PASS = "ClaveTemporal123!";


// ============================================================
// BLOQUE 5: BASIC AUTH SOLO PARA /admin
// ============================================================
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


// ============================================================
// BLOQUE 6: CONFIGURACION DE NODE-RED
// ============================================================
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


// ============================================================
// BLOQUE 7: CONEXION A POSTGRESQL
// ============================================================
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


// ============================================================
// BLOQUE 8: CREACION DE TABLA SI NO EXISTE
// ============================================================
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


// ============================================================
// BLOQUE 9: INICIALIZACION DE NODE-RED
// ============================================================
RED.init(server, settings);

// Editor protegido
app.use("/admin", basicAuth, RED.httpAdmin);


// ============================================================
// BLOQUE 10: API - GUARDAR LECTURA EN BASE DE DATOS
// ============================================================
app.post("/api/save-reading", async (req, res) => {
  try {
    const data = req.body;

    if (!data.device_id) {
      return res.status(400).json({
        ok: false,
        error: "Falta device_id"
      });
    }

    const sql = `
      INSERT INTO power_readings (
        device_id,
        voltage_an,
        voltage_bn,
        voltage_cn,
        current_a,
        current_b,
        current_c,
        frequency,
        power_total,
        energy_total,
        raw_payload
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id, created_at
    `;

    const values = [
      data.device_id,
      data.voltage_an ?? null,
      data.voltage_bn ?? null,
      data.voltage_cn ?? null,
      data.current_a ?? null,
      data.current_b ?? null,
      data.current_c ?? null,
      data.frequency ?? data.frecuencia ?? null,
      data.power_total ?? data.ptot ?? null,
      data.energy_total ?? data.edel ?? null,
      data
    ];

    const result = await pool.query(sql, values);

    res.json({
      ok: true,
      id: result.rows[0].id,
      created_at: result.rows[0].created_at
    });
  } catch (error) {
    console.error("Error guardando lectura:", error.message);
    res.status(500).json({
      ok: false,
      error: "Error guardando lectura"
    });
  }
});


// ============================================================
// BLOQUE 11: API - ULTIMA LECTURA DE UN DISPOSITIVO
// ============================================================
app.get("/api/device/:device_id", async (req, res) => {
  try {
    const { device_id } = req.params;

    const result = await pool.query(
      `
      SELECT raw_payload, created_at
      FROM power_readings
      WHERE device_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [device_id]
    );

    if (result.rows.length === 0) {
      return res.json({
        ok: false,
        error: "No se encontraron datos del dispositivo"
      });
    }

    res.json({
      ok: true,
      device_id,
      data: result.rows[0].raw_payload,
      created_at: result.rows[0].created_at
    });
  } catch (error) {
    console.error("Error consultando device:", error.message);
    res.status(500).json({
      ok: false,
      error: "Error consultando device"
    });
  }
});


// ============================================================
// BLOQUE 12: API - HISTORICO PARA GRAFICAS
// NOTA: AQUI SE INCLUYE raw_payload PARA PODER LEER
// ptot, qtot y stot DESDE EL DASHBOARD
// ============================================================
app.get("/api/history", async (req, res) => {
  try {
    const { device_id, from, to } = req.query;

    if (!device_id) {
      return res.status(400).json({
        ok: false,
        error: "Falta device_id"
      });
    }

    let sql = `
      SELECT
        id,
        device_id,
        voltage_an,
        current_a,
        frequency,
        power_total,
        energy_total,
        raw_payload,
        created_at
      FROM power_readings
      WHERE device_id = $1
    `;

    const values = [device_id];

    if (from && to) {
      sql += ` AND created_at >= $2 AND created_at < $3::date + INTERVAL '1 day'`;
      values.push(from, to);
    }

    sql += ` ORDER BY created_at ASC`;

    const result = await pool.query(sql, values);

    res.json({
      ok: true,
      device_id,
      total: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error("Error consultando histórico:", error.message);
    res.status(500).json({
      ok: false,
      error: "Error consultando histórico"
    });
  }
});


// ============================================================
// BLOQUE 12A: API - EXPORTAR HISTORICO EN CSV POR RANGO
// ============================================================
app.get("/api/history/export", async (req, res) => {
  try {
    const { device_id, from, to } = req.query;

    if (!device_id) {
      return res.status(400).json({
        ok: false,
        error: "Falta device_id"
      });
    }

    if (!from || !to) {
      return res.status(400).json({
        ok: false,
        error: "Faltan fechas from y to"
      });
    }

    const sql = `
      SELECT
        created_at,
        device_id,
        voltage_an,
        current_a,
        frequency,
        power_total,
        energy_total,
        raw_payload
      FROM power_readings
      WHERE device_id = $1
        AND created_at >= $2
        AND created_at < $3::date + INTERVAL '1 day'
      ORDER BY created_at ASC
    `;

    const values = [device_id, from, to];
    const result = await pool.query(sql, values);
    const rows = result.rows;

    const headers = [
      "created_at",
      "device_id",
      "voltage_an",
      "current_a",
      "frequency",
      "ptot",
      "qtot",
      "stot",
      "edel"
    ];

    const csvLines = [headers.join(",")];

    for (const row of rows) {
      const p = row.raw_payload || {};

      const rowValues = [
        row.created_at ? new Date(row.created_at).toISOString() : "",
        row.device_id ?? "",
        row.voltage_an ?? "",
        row.current_a ?? "",
        row.frequency ?? "",
        p.ptot ?? "",
        p.qtot ?? "",
        p.stot ?? "",
        p.edel ?? ""
      ].map(value => {
        const text = String(value);
        return `"${text.replace(/"/g, '""')}"`;
      });

      csvLines.push(rowValues.join(","));
    }

    const csvContent = "\uFEFF" + csvLines.join("\n");
    const fileName = `${device_id}_${from}_to_${to}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(csvContent);

  } catch (error) {
    console.error("Error exportando CSV:", error.message);
    res.status(500).json({
      ok: false,
      error: "Error exportando CSV"
    });
  }
});

// ============================================================
// BLOQUE 13: ENDPOINTS DE NODE-RED
// IMPORTANTE: VA AL FINAL PARA NO INTERFERIR CON /api/*
// ============================================================
app.use("/", RED.httpNode);


// ============================================================
// BLOQUE 14: INICIO DEL SERVIDOR Y NODE-RED
// ============================================================
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
