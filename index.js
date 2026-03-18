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
// BLOQUE 7A: MEMORIA TEMPORAL DE ULTIMA LECTURA POR MEDIDOR
// ============================================================
const latestReadings = {};

function buildMeterKey(deviceId, pmSlave) {
  return `${deviceId}__${pmSlave}`;
}

async function probarPostgres() {
  try {
    const result = await pool.query("SELECT NOW() as fecha");
    console.log("PostgreSQL conectado OK:", result.rows[0].fecha);
  } catch (error) {
    console.error("Error conectando a PostgreSQL:", error.message);
  }
}

// ============================================================
// BLOQUE 8: CREACION DE TABLAS E INDICES
// ============================================================
async function crearTablasSiNoExisten() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS power_meters (
        id BIGSERIAL PRIMARY KEY,
        device_id TEXT NOT NULL,
        device_name TEXT,
        pm_slave INTEGER NOT NULL,
        pm_name TEXT,
        model TEXT,
        fw TEXT,
        token TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (device_id, pm_slave)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS power_readings (
        id BIGSERIAL PRIMARY KEY,

        device_id TEXT NOT NULL,
        device_name TEXT,
        pm_slave INTEGER NOT NULL,
        pm_name TEXT,

        token TEXT,
        model TEXT,
        fw TEXT,
        status TEXT,

        uptime_ms BIGINT,
        ip TEXT,
        rssi INTEGER,
        timestamp_ms BIGINT,

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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS power_latest (
        id BIGSERIAL PRIMARY KEY,

        device_id TEXT NOT NULL,
        device_name TEXT,
        pm_slave INTEGER NOT NULL,
        pm_name TEXT,

        token TEXT,
        model TEXT,
        fw TEXT,
        status TEXT,

        uptime_ms BIGINT,
        ip TEXT,
        rssi INTEGER,
        timestamp_ms BIGINT,

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
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        UNIQUE (device_id, pm_slave)
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_power_readings_device_slave_time
      ON power_readings (device_id, pm_slave, created_at DESC);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_power_readings_device_slave
      ON power_readings (device_id, pm_slave);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_power_latest_device_slave
      ON power_latest (device_id, pm_slave);
    `);

    console.log("Tablas power_meters, power_readings y power_latest listas");
  } catch (error) {
    console.error("Error creando tablas:", error.message);
  }
}

// ============================================================
// BLOQUE 8A: REGISTRAR MEDIDOR LOGICO
// ============================================================
async function upsertMeter(data) {
  const sql = `
    INSERT INTO power_meters (
      device_id,
      device_name,
      pm_slave,
      pm_name,
      model,
      fw,
      token,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    ON CONFLICT (device_id, pm_slave)
    DO UPDATE SET
      device_name = EXCLUDED.device_name,
      pm_name = EXCLUDED.pm_name,
      model = EXCLUDED.model,
      fw = EXCLUDED.fw,
      token = EXCLUDED.token,
      updated_at = NOW()
  `;

  const values = [
    data.device_id,
    data.device_name ?? null,
    data.pm_slave,
    data.pm_name ?? null,
    data.model ?? null,
    data.fw ?? null,
    data.token ?? null
  ];

  await pool.query(sql, values);
}

// ============================================================
// BLOQUE 8B: ACTUALIZAR ULTIMO VALOR EN DB
// ============================================================
async function upsertLatest(data) {
  const p = data.payload || {};

  const sql = `
    INSERT INTO power_latest (
      device_id,
      device_name,
      pm_slave,
      pm_name,
      token,
      model,
      fw,
      status,
      uptime_ms,
      ip,
      rssi,
      timestamp_ms,

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
      created_at,
      updated_at
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
      $13,$14,$15,
      $16,$17,$18,$19,
      $20,$21,$22,$23,
      $24,$25,$26,$27,
      $28,$29,$30,$31,
      $32,$33,$34,$35,
      $36,
      $37,$38,$39,
      $40,$41,$42,$43,
      $44,$45,
      $46,
      NOW(),
      NOW()
    )
    ON CONFLICT (device_id, pm_slave)
    DO UPDATE SET
      device_name = EXCLUDED.device_name,
      pm_name = EXCLUDED.pm_name,
      token = EXCLUDED.token,
      model = EXCLUDED.model,
      fw = EXCLUDED.fw,
      status = EXCLUDED.status,
      uptime_ms = EXCLUDED.uptime_ms,
      ip = EXCLUDED.ip,
      rssi = EXCLUDED.rssi,
      timestamp_ms = EXCLUDED.timestamp_ms,

      voltage_a = EXCLUDED.voltage_a,
      voltage_b = EXCLUDED.voltage_b,
      voltage_c = EXCLUDED.voltage_c,

      current_a = EXCLUDED.current_a,
      current_b = EXCLUDED.current_b,
      current_c = EXCLUDED.current_c,
      current_n = EXCLUDED.current_n,

      p_a = EXCLUDED.p_a,
      p_b = EXCLUDED.p_b,
      p_c = EXCLUDED.p_c,
      p_tot = EXCLUDED.p_tot,

      q_a = EXCLUDED.q_a,
      q_b = EXCLUDED.q_b,
      q_c = EXCLUDED.q_c,
      q_tot = EXCLUDED.q_tot,

      s_a = EXCLUDED.s_a,
      s_b = EXCLUDED.s_b,
      s_c = EXCLUDED.s_c,
      s_tot = EXCLUDED.s_tot,

      pf_a = EXCLUDED.pf_a,
      pf_b = EXCLUDED.pf_b,
      pf_c = EXCLUDED.pf_c,
      pf_tot = EXCLUDED.pf_tot,

      frecuencia = EXCLUDED.frecuencia,

      thd_va = EXCLUDED.thd_va,
      thd_vb = EXCLUDED.thd_vb,
      thd_vc = EXCLUDED.thd_vc,

      thd_ia = EXCLUDED.thd_ia,
      thd_ib = EXCLUDED.thd_ib,
      thd_ic = EXCLUDED.thd_ic,
      thd_in = EXCLUDED.thd_in,

      desbalance_v = EXCLUDED.desbalance_v,
      desbalance_i = EXCLUDED.desbalance_i,

      raw_payload = EXCLUDED.raw_payload,
      updated_at = NOW()
    RETURNING id, updated_at
  `;

  const values = [
    data.device_id,
    data.device_name ?? null,
    data.pm_slave,
    data.pm_name ?? null,
    data.token ?? null,
    data.model ?? null,
    data.fw ?? null,
    data.status ?? null,
    data.uptime_ms ?? null,
    data.ip ?? null,
    data.rssi ?? null,
    data.timestamp_ms ?? null,

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

  return pool.query(sql, values);
}

// ============================================================
// BLOQUE 9: INICIALIZACION DE NODE-RED
// ============================================================
RED.init(server, settings);
app.use("/admin", basicAuth, RED.httpAdmin);

// ============================================================
// BLOQUE 10: API - GUARDAR LECTURA
// ============================================================
app.post("/api/save-reading", async (req, res) => {
  try {
    const data = req.body;
    const p = data.payload || {};

    if (!data.device_id) {
      return res.status(400).json({ ok: false, error: "Falta device_id" });
    }

    if (data.pm_slave === undefined || data.pm_slave === null) {
      return res.status(400).json({ ok: false, error: "Falta pm_slave" });
    }

    const pmSlave = Number(data.pm_slave);

    if (!Number.isInteger(pmSlave)) {
      return res.status(400).json({ ok: false, error: "pm_slave debe ser entero" });
    }

    data.pm_slave = pmSlave;

    const meterKey = buildMeterKey(data.device_id, data.pm_slave);

    latestReadings[meterKey] = {
      data,
      updated_at: new Date().toISOString()
    };

    await upsertMeter(data);
    await upsertLatest(data);

    const SAVE_INTERVAL = 10000;

    if (!global.lastSaveTimes) {
      global.lastSaveTimes = {};
    }

    const now = Date.now();
    const lastSave = global.lastSaveTimes[meterKey] || 0;

    if (now - lastSave < SAVE_INTERVAL) {
      return res.json({
        ok: true,
        saved_to_db: false,
        updated_latest: true,
        device_id: data.device_id,
        device_name: data.device_name ?? null,
        pm_slave: data.pm_slave,
        pm_name: data.pm_name ?? null,
        message: "Dato recibido, ultimo valor actualizado"
      });
    }

    global.lastSaveTimes[meterKey] = now;

    const sql = `
      INSERT INTO power_readings (
        device_id,
        device_name,
        pm_slave,
        pm_name,
        token,
        model,
        fw,
        status,
        uptime_ms,
        ip,
        rssi,
        timestamp_ms,

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
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
        $13,$14,$15,
        $16,$17,$18,$19,
        $20,$21,$22,$23,
        $24,$25,$26,$27,
        $28,$29,$30,$31,
        $32,$33,$34,$35,
        $36,
        $37,$38,$39,
        $40,$41,$42,$43,
        $44,$45,
        $46
      )
      RETURNING id, created_at
    `;

    const values = [
      data.device_id,
      data.device_name ?? null,
      data.pm_slave,
      data.pm_name ?? null,
      data.token ?? null,
      data.model ?? null,
      data.fw ?? null,
      data.status ?? null,
      data.uptime_ms ?? null,
      data.ip ?? null,
      data.rssi ?? null,
      data.timestamp_ms ?? null,

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
      updated_latest: true,
      id: result.rows[0].id,
      created_at: result.rows[0].created_at,
      device_id: data.device_id,
      device_name: data.device_name ?? null,
      pm_slave: data.pm_slave,
      pm_name: data.pm_name ?? null
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
// BLOQUE 11: API - ULTIMA LECTURA DE UN PM EN TIEMPO REAL
// ============================================================
app.get("/api/device/:device_id", async (req, res) => {
  try {
    const { device_id } = req.params;
    const pmSlave = Number(req.query.pm_slave);

    if (!Number.isInteger(pmSlave)) {
      return res.status(400).json({
        ok: false,
        error: "Falta pm_slave valido en query"
      });
    }

    const sql = `
      SELECT
        l.device_id,
        COALESCE(m.device_name, l.device_name) AS device_name,
        l.pm_slave,
        COALESCE(m.pm_name, l.pm_name) AS pm_name,

        l.token,
        l.model,
        l.fw,
        l.status,
        l.uptime_ms,
        l.ip,
        l.rssi,
        l.timestamp_ms,

        l.voltage_a,
        l.voltage_b,
        l.voltage_c,

        l.current_a,
        l.current_b,
        l.current_c,
        l.current_n,

        l.p_a,
        l.p_b,
        l.p_c,
        l.p_tot,

        l.q_a,
        l.q_b,
        l.q_c,
        l.q_tot,

        l.s_a,
        l.s_b,
        l.s_c,
        l.s_tot,

        l.pf_a,
        l.pf_b,
        l.pf_c,
        l.pf_tot,

        l.frecuencia,

        l.thd_va,
        l.thd_vb,
        l.thd_vc,

        l.thd_ia,
        l.thd_ib,
        l.thd_ic,
        l.thd_in,

        l.desbalance_v,
        l.desbalance_i,

        l.raw_payload,
        l.created_at,
        l.updated_at

      FROM power_latest l
      LEFT JOIN power_meters m
        ON l.device_id = m.device_id
       AND l.pm_slave = m.pm_slave
      WHERE l.device_id = $1
        AND l.pm_slave = $2
      LIMIT 1
    `;

    const result = await pool.query(sql, [device_id, pmSlave]);

    if (result.rows.length === 0) {
      return res.json({
        ok: false,
        error: "No se encontraron datos del medidor",
        device_id,
        pm_slave: pmSlave
      });
    }

    res.json({
      ok: true,
      device_id,
      pm_slave: pmSlave,
      data: result.rows[0],
      created_at: result.rows[0].updated_at
    });
  } catch (error) {
    console.error("Error consultando device:", error);
    res.status(500).json({
      ok: false,
      error: "Error consultando device",
      detail: error.message
    });
  }
});

// ============================================================
// BLOQUE 11A: API - LISTAR MEDIDORES DE UN DEVICE
// ============================================================
app.get("/api/meters/:device_id", async (req, res) => {
  try {
    const { device_id } = req.params;

    const result = await pool.query(
      `
      SELECT
        device_id,
        device_name,
        pm_slave,
        pm_name,
        model,
        fw,
        token,
        created_at,
        updated_at
      FROM power_meters
      WHERE device_id = $1
      ORDER BY pm_slave ASC
      `,
      [device_id]
    );

    res.json({
      ok: true,
      device_id,
      total: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error("Error consultando medidores:", error.message);
    res.status(500).json({
      ok: false,
      error: "Error consultando medidores"
    });
  }
});

// ============================================================
// BLOQUE 12: API - HISTORICO PARA GRAFICAS
// ============================================================
app.get("/api/history", async (req, res) => {
  try {
    const { device_id, from, to } = req.query;
    const pmSlave = Number(req.query.pm_slave);

    if (!device_id) {
      return res.status(400).json({ ok: false, error: "Falta device_id" });
    }

    if (!Number.isInteger(pmSlave)) {
      return res.status(400).json({ ok: false, error: "Falta pm_slave valido" });
    }

    let sql = `
      SELECT
        r.device_id,
        COALESCE(m.device_name, r.device_name) AS device_name,
        r.pm_slave,
        COALESCE(m.pm_name, r.pm_name) AS pm_name,

        r.voltage_a,
        r.voltage_b,
        r.voltage_c,

        r.current_a,
        r.current_b,
        r.current_c,
        r.current_n,

        r.p_a,
        r.p_b,
        r.p_c,
        r.p_tot,

        r.q_a,
        r.q_b,
        r.q_c,
        r.q_tot,

        r.s_a,
        r.s_b,
        r.s_c,
        r.s_tot,

        r.pf_a,
        r.pf_b,
        r.pf_c,
        r.pf_tot,

        r.frecuencia,

        r.thd_va,
        r.thd_vb,
        r.thd_vc,

        r.thd_ia,
        r.thd_ib,
        r.thd_ic,
        r.thd_in,

        r.desbalance_v,
        r.desbalance_i,

        r.raw_payload,
        r.created_at
      FROM power_readings r
      LEFT JOIN power_meters m
        ON r.device_id = m.device_id
       AND r.pm_slave = m.pm_slave
      WHERE r.device_id = $1
        AND r.pm_slave = $2
    `;

    const values = [device_id, pmSlave];

    if (from && to) {
      sql += `
        AND r.created_at >= (($3::date)::timestamp AT TIME ZONE 'America/Guayaquil')
        AND r.created_at < (((($4::date) + INTERVAL '1 day')::timestamp) AT TIME ZONE 'America/Guayaquil')
      `;
      values.push(from, to);
    }

    sql += ` ORDER BY r.created_at ASC`;

    const result = await pool.query(sql, values);

    res.json({
      ok: true,
      device_id,
      pm_slave: pmSlave,
      total: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error("Error consultando histórico:", error);
    res.status(500).json({
      ok: false,
      error: "Error consultando histórico",
      detail: error.message
    });
  }
});

// ============================================================
// BLOQUE 12A: API - EXPORTAR HISTORICO EN CSV POR RANGO
// ============================================================
app.get("/api/history/export", async (req, res) => {
  try {
    const { device_id, from, to } = req.query;
    const pmSlave = Number(req.query.pm_slave);

    if (!device_id) {
      return res.status(400).json({ ok: false, error: "Falta device_id" });
    }

    if (!Number.isInteger(pmSlave)) {
      return res.status(400).json({ ok: false, error: "Falta pm_slave valido" });
    }

    if (!from || !to) {
      return res.status(400).json({ ok: false, error: "Faltan fechas from y to" });
    }

    const sql = `
      SELECT
        r.created_at,
        r.device_id,
        COALESCE(m.device_name, r.device_name) AS device_name,
        r.pm_slave,
        COALESCE(m.pm_name, r.pm_name) AS pm_name,

        r.voltage_a,
        r.voltage_b,
        r.voltage_c,

        r.current_a,
        r.current_b,
        r.current_c,
        r.current_n,

        r.p_a,
        r.p_b,
        r.p_c,
        r.p_tot,

        r.q_a,
        r.q_b,
        r.q_c,
        r.q_tot,

        r.s_a,
        r.s_b,
        r.s_c,
        r.s_tot,

        r.pf_a,
        r.pf_b,
        r.pf_c,
        r.pf_tot,

        r.frecuencia,

        r.thd_va,
        r.thd_vb,
        r.thd_vc,

        r.thd_ia,
        r.thd_ib,
        r.thd_ic,
        r.thd_in,

        r.desbalance_v,
        r.desbalance_i

      FROM power_readings r
      LEFT JOIN power_meters m
        ON r.device_id = m.device_id
       AND r.pm_slave = m.pm_slave
      WHERE r.device_id = $1
        AND r.pm_slave = $2
        AND r.created_at >= (($3::date)::timestamp AT TIME ZONE 'America/Guayaquil')
        AND r.created_at < (((($4::date) + INTERVAL '1 day')::timestamp) AT TIME ZONE 'America/Guayaquil')
      ORDER BY r.created_at ASC
    `;

    const values = [device_id, pmSlave, from, to];
    const result = await pool.query(sql, values);
    const rows = result.rows;

    const fileName = `${device_id}_PM${pmSlave}_${from}_to_${to}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.write("\uFEFF");

    const headers = [
      "created_at",
      "device_id",
      "device_name",
      "pm_slave",
      "pm_name",
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
        row.device_name ?? "",
        row.pm_slave ?? "",
        row.pm_name ?? "",

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
    console.error("Error exportando CSV:", error);
    res.status(500).json({
      ok: false,
      error: "Error exportando CSV",
      detail: error.message
    });
  }
});

// ============================================================
// BLOQUE 13: ENDPOINTS DE NODE-RED
// ============================================================
app.use("/", RED.httpNode);

// ============================================================
// BLOQUE 14: INICIO DEL SERVIDOR Y NODE-RED
// ============================================================
async function iniciar() {
  await probarPostgres();
  await crearTablasSiNoExisten();
  await RED.start();
}

const PORT = process.env.PORT || 1880;

server.listen(PORT, async () => {
  console.log("Node-RED corriendo en puerto " + PORT);
  console.log("Editor en /admin");
  await iniciar();
});
