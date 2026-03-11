const http = require("http");
const express = require("express");
const RED = require("node-red");

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
  functionGlobalContext: {}
};

RED.init(server, settings);

// Protege solo el editor
app.use("/admin", basicAuth, RED.httpAdmin);

// Deja públicos los endpoints HTTP como /analyzer
app.use("/", RED.httpNode);

// Iniciar runtime de Node-RED
RED.start();

// Escuchar solo una vez
const PORT = process.env.PORT || 1880;
server.listen(PORT, () => {
  console.log("Node-RED corriendo en puerto " + PORT);
  console.log("Editor en /admin");
});
