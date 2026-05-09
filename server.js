// ============================================================
// MAVILLESAINE — Backend API
// Stack : Node.js + Express + Supabase + Twilio (SMS)
// ============================================================
// INSTALLATION :
//   npm install express cors dotenv @supabase/supabase-js
//              multer sharp twilio jsonwebtoken bcryptjs
//              express-rate-limit helmet morgan uuid
//
// VARIABLES D'ENVIRONNEMENT (.env) :
//   PORT=3000
//   SUPABASE_URL=https://xxxx.supabase.co
//   SUPABASE_SERVICE_KEY=xxxx
//   JWT_SECRET=un_secret_tres_long_et_aleatoire
//   TWILIO_ACCOUNT_SID=ACxxxx
//   TWILIO_AUTH_TOKEN=xxxx
//   TWILIO_PHONE_NUMBER=+33xxxxxxxxx
//   CLOUDINARY_URL=cloudinary://xxxx  (pour les photos)
// ============================================================

const express      = require("express");
const cors         = require("cors");
const helmet       = require("helmet");
const morgan       = require("morgan");
const rateLimit    = require("express-rate-limit");
const dotenv       = require("dotenv");

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Supabase client ───────────────────────────────────────────
const { supabase } = require("./routes/supabase");

// ── Middlewares ───────────────────────────────────────────────
app.use(helmet());
app.set('trust proxy', 1); // Nécessaire pour Render (reverse proxy)
app.use(cors({ origin: "*", methods: ["GET","POST","PUT","PATCH","DELETE"] }));
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.use(morgan("combined"));

// Rate limiting global
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200,
  message: { error: "Trop de requêtes, réessayez dans 15 minutes." }
}));

// Rate limiting strict pour les signalements (anti-spam)
const signalementsLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: 10,
  message: { error: "Maximum 10 signalements par heure par IP." }
});

// ── Routes ────────────────────────────────────────────────────
app.use("/api/auth",          require("./routes/auth"));
app.use("/api/communes",      require("./routes/communes"));
app.use("/api/signalements",  signalementsLimiter, require("./routes/signalements"));
app.use("/api/techniciens",   require("./routes/techniciens"));
app.use("/api/interventions", require("./routes/interventions"));
app.use("/api/stats",         require("./routes/stats"));

// ── Health check ──────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString(), version: "1.0.0" });
});

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Route non trouvée" });
});

// ── Erreurs globales ──────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("[ERROR]", err.stack);
  res.status(err.status || 500).json({
    error: err.message || "Erreur interne du serveur"
  });
});

// ── Démarrage ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ MaVilleSaine API démarrée sur le port ${PORT}`);
  console.log(`🔗 Health check : http://localhost:${PORT}/health`);
});

module.exports = { app };
