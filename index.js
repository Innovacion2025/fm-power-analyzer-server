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

// ============================================================
// BLOQUE 7A: MEMORIA TEMPORAL DE ULTIMA LECTURA POR EQUIPO
// ============================================================
const latestReadings = {};

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
// AHORA GUARDA LAS 33 VARIABLES DEL OBJETO payload
// ============================================================
async function crearTablaSiNoExiste() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS power_readings (
        id BIGSERIAL PRIMARY KEY,
        device_id TEXT NOT NULL,

        voltage_a NUMERIC(12,3),
        voltage_b NUMERIC(12,3),
        voltage_c NUMERIC(12,3),

        current_a NUMERIC(12,3),
        current_b NUMERIC(12,3),
        current_c NUMERIC(12,3),
        current_n NUMERIC(12,3),

        p_a NUMERIC(14,3),
        p_b NUMERIC(14,3),
        p_c NUMERIC(14,3),
        p_tot NUMERIC(14,3),

        q_a NUMERIC(14,3),
        q_b NUMERIC(14,3),
        q_c NUMERIC(14,3),
        q_tot NUMERIC(14,3),

        s_a NUMERIC(14,3),
        s_b NUMERIC(14,3),
        s_c NUMERIC(14,3),
        s_tot NUMERIC(14,3),

        pf_a NUMERIC(12,3),
        pf_b NUMERIC(12,3),
        pf_c NUMERIC(12,3),
        pf_tot NUMERIC(12,3),

        frecuencia NUMERIC(12,3),

        thd_va NUMERIC(12,3),
        thd_vb NUMERIC(12,3),
        thd_vc NUMERIC(12,3),

        thd_ia NUMERIC(12,3),
        thd_ib NUMERIC(12,3),
        thd_ic NUMERIC(12,3),
        thd_in NUMERIC(12,3),

        desbalance_v NUMERIC(12,3),
        desbalance_i NUMERIC(12,3),

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
// BLOQUE 10: API - GUARDAR LECTURA
// SIEMPRE ACTUALIZA MEMORIA PARA TIEMPO REAL
// SOLO GUARDA EN POSTGRESQL CADA X SEGUNDOS
// AHORA TOMA SOLO LAS VARIABLES DESDE req.body.payload
// ============================================================
app.post("/api/save-reading", async (req, res) => {
  try {
    const data = req.body;
    const p = data.payload || {};

    if (!data.device_id) {
      return res.status(400).json({
        ok: false,
        error: "Falta device_id"
      });
    }

    // ------------------------------------------------------------
    // 1. SIEMPRE guardar último dato en memoria (tiempo real)
    // ------------------------------------------------------------
    latestReadings[data.device_id] = {
      data,
      updated_at: new Date().toISOString()
    };

    // ------------------------------------------------------------
    // 2. Control de frecuencia de guardado a PostgreSQL
    // ------------------------------------------------------------
    const SAVE_INTERVAL = 10000; // 10 segundos

    if (!global.lastSaveTimes) {
      global.lastSaveTimes = {};
    }

    const now = Date.now();
    const lastSave = global.lastSaveTimes[data.device_id] || 0;

    // Si todavía no toca guardar en DB, responder OK pero sin insertar
    if (now - lastSave < SAVE_INTERVAL) {
      return res.json({
        ok: true,
        saved_to_db: false,
        message: "Dato recibido, actualizado en memoria"
      });
    }

    // Actualizar marca de tiempo del último guardado
    global.lastSaveTimes[data.device_id] = now;

    // ------------------------------------------------------------
    // 3. Guardar en PostgreSQL
    // ------------------------------------------------------------
    const sql = `
      INSERT INTO power_readings (
        device_id,

        voltage_a,
        voltage_b,
        voltage_c,

        current_a,
        current_b,
        current_c,
        current_n,

        p_a,
        p_b,
        p_c,
        p_tot,

        q_a,
        q_b,
        q_c,
        q_tot,

        s_a,
        s_b,
        s_c,
        s_tot,

        pf_a,
        pf_b,
        pf_c,
        pf_tot,

        frecuencia,

        thd_va,
        thd_vb,
        thd_vc,

        thd_ia,
        thd_ib,
        thd_ic,
        thd_in,

        desbalance_v,
        desbalance_i,

        raw_payload
      )
      VALUES (
        $1,
        $2,$3,$4,
        $5,$6,$7,$8,
        $9,$10,$11,$12,
        $13,$14,$15,$16,
        $17,$18,$19,$20,
        $21,$22,$23,$24,
        $25,
        $26,$27,$28,
        $29,$30,$31,$32,
        $33,$34,
        $35
      )
      RETURNING id, created_at
    `;

    const values = [
      data.device_id,

      p.voltage_a ?? null,
      p.voltage_b ?? null,
      p.voltage_c ?? null,

      p.current_a ?? null,
      p.current_b ?? null,
      p.current_c ?? null,
      p.current_n ?? null,

      p.p_a ?? null,
      p.p_b ?? null,
      p.p_c ?? null,
      p.p_tot ?? null,

      p.q_a ?? null,
      p.q_b ?? null,
      p.q_c ?? null,
      p.q_tot ?? null,

      p.s_a ?? null,
      p.s_b ?? null,
      p.s_c ?? null,
      p.s_tot ?? null,

      p.pf_a ?? null,
      p.pf_b ?? null,
      p.pf_c ?? null,
      p.pf_tot ?? null,

      p.frecuencia ?? null,

      p.thd_va ?? null,
      p.thd_vb ?? null,
      p.thd_vc ?? null,

      p.thd_ia ?? null,
      p.thd_ib ?? null,
      p.thd_ic ?? null,
      p.thd_in ?? null,

      p.desbalance_v ?? null,
      p.desbalance_i ?? null,

      data
    ];

    const result = await pool.query(sql, values);

    return res.json({
      ok: true,
      saved_to_db: true,
      id: result.rows[0].id,
      created_at: result.rows[0].created_at
    });

  } catch (error) {
    console.error("Error guardando lectura:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Error guardando lectura"
    });
  }
});

// ============================================================
// BLOQUE 11: API - ULTIMA LECTURA DE UN DISPOSITIVO (TIEMPO REAL)
// LEE DESDE MEMORIA, NO DESDE POSTGRESQL
// ============================================================
app.get("/api/device/:device_id", async (req, res) => {
  try {
    const { device_id } = req.params;

    const latest = latestReadings[device_id];

    if (!latest) {
      return res.json({
        ok: false,
        error: "No se encontraron datos del dispositivo"
      });
    }

    res.json({
      ok: true,
      device_id,
      data: latest.data,
      created_at: latest.updated_at
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
// FILTRA POR FECHAS EN ZONA HORARIA DE GUAYAQUIL
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

        voltage_a,
        voltage_b,
        voltage_c,

        current_a,
        current_b,
        current_c,
        current_n,

        p_a,
        p_b,
        p_c,
        p_tot,

        q_a,
        q_b,
        q_c,
        q_tot,

        s_a,
        s_b,
        s_c,
        s_tot,

        pf_a,
        pf_b,
        pf_c,
        pf_tot,

        frecuencia,

        thd_va,
        thd_vb,
        thd_vc,

        thd_ia,
        thd_ib,
        thd_ic,
        thd_in,

        desbalance_v,
        desbalance_i,

        raw_payload,
        created_at
      FROM power_readings
      WHERE device_id = $1
    `;

    const values = [device_id];

    if (from && to) {
      sql += `
        AND created_at >= (($2::date)::timestamp AT TIME ZONE 'America/Guayaquil')
        AND created_at < (((($3::date) + INTERVAL '1 day')::timestamp) AT TIME ZONE 'America/Guayaquil')
      `;
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
// FILTRA POR FECHAS EN ZONA HORARIA DE GUAYAQUIL
// ENVIA EL CSV POR PARTES PARA INICIAR LA DESCARGA MAS RAPIDO
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

        voltage_a,
        voltage_b,
        voltage_c,

        current_a,
        current_b,
        current_c,
        current_n,

        p_a,
        p_b,
        p_c,
        p_tot,

        q_a,
        q_b,
        q_c,
        q_tot,

        s_a,
        s_b,
        s_c,
        s_tot,

        pf_a,
        pf_b,
        pf_c,
        pf_tot,

        frecuencia,

        thd_va,
        thd_vb,
        thd_vc,

        thd_ia,
        thd_ib,
        thd_ic,
        thd_in,

        desbalance_v,
        desbalance_i,

        raw_payload
      FROM power_readings
      WHERE device_id = $1
        AND created_at >= (($2::date)::timestamp AT TIME ZONE 'America/Guayaquil')
        AND created_at < (((($3::date) + INTERVAL '1 day')::timestamp) AT TIME ZONE 'America/Guayaquil')
      ORDER BY created_at ASC
    `;

    const values = [device_id, from, to];
    const result = await pool.query(sql, values);
    const rows = result.rows;

    const fileName = `${device_id}_${from}_to_${to}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    // BOM para Excel
    res.write("\uFEFF");

    // Cabecera CSV
    const headers = [
      "created_at",
      "device_id",
      "voltage_a",
      "voltage_b",
      "voltage_c",
      "current_a",
      "current_b",
      "current_c",
      "current_n",
      "p_a",
      "p_b",
      "p_c",
      "p_tot",
      "q_a",
      "q_b",
      "q_c",
      "q_tot",
      "s_a",
      "s_b",
      "s_c",
      "s_tot",
      "pf_a",
      "pf_b",
      "pf_c",
      "pf_tot",
      "frecuencia",
      "thd_va",
      "thd_vb",
      "thd_vc",
      "thd_ia",
      "thd_ib",
      "thd_ic",
      "thd_in",
      "desbalance_v",
      "desbalance_i"
    ];

    res.write(headers.join(",") + "\n");

    for (const row of rows) {
      const rowValues = [
        row.created_at
          ? new Date(row.created_at).toLocaleString("es-EC", {
              timeZone: "America/Guayaquil"
            })
          : "",
        row.device_id ?? "",

        row.voltage_a ?? "",
        row.voltage_b ?? "",
        row.voltage_c ?? "",

        row.current_a ?? "",
        row.current_b ?? "",
        row.current_c ?? "",
        row.current_n ?? "",

        row.p_a ?? "",
        row.p_b ?? "",
        row.p_c ?? "",
        row.p_tot ?? "",

        row.q_a ?? "",
        row.q_b ?? "",
        row.q_c ?? "",
        row.q_tot ?? "",

        row.s_a ?? "",
        row.s_b ?? "",
        row.s_c ?? "",
        row.s_tot ?? "",

        row.pf_a ?? "",
        row.pf_b ?? "",
        row.pf_c ?? "",
        row.pf_tot ?? "",

        row.frecuencia ?? "",

        row.thd_va ?? "",
        row.thd_vb ?? "",
        row.thd_vc ?? "",

        row.thd_ia ?? "",
        row.thd_ib ?? "",
        row.thd_ic ?? "",
        row.thd_in ?? "",

        row.desbalance_v ?? "",
        row.desbalance_i ?? ""
      ].map(value => {
        const text = String(value);
        return `"${text.replace(/"/g, '""')}"`;
      });

      res.write(rowValues.join(",") + "\n");
    }

    res.end();

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
