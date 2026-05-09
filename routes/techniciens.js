// ============================================================
// MAVILLESAINE — Routes API complètes
// Fichier : routes/index.js  (copier chaque section dans son fichier)
// ============================================================

const express = require("express");
const jwt     = require("jsonwebtoken");
const bcrypt  = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const { supabase } = require("../server");

// ── Middleware d'authentification ─────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Token manquant" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Token invalide ou expiré" });
  }
}

function superviseurOnly(req, res, next) {
  if (!["superviseur","admin"].includes(req.user?.role)) {
    return res.status(403).json({ error: "Accès réservé aux superviseurs" });
  }
  next();
}

// ════════════════════════════════════════════════════════════
// ROUTE : AUTH  (/api/auth)
// ════════════════════════════════════════════════════════════
const authRouter = express.Router();

// POST /api/auth/login — connexion superviseur
authRouter.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email et mot de passe requis" });

    const { data: user, error } = await supabase
      .from("superviseurs")
      .select("*")
      .eq("email", email.toLowerCase())
      .single();

    if (error || !user)
      return res.status(401).json({ error: "Identifiants incorrects" });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ error: "Identifiants incorrects" });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, commune_id: user.commune_id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: { id: user.id, nom: user.nom, email: user.email, role: user.role, commune_id: user.commune_id }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/register — créer un superviseur (admin seulement)
authRouter.post("/register", authMiddleware, superviseurOnly, async (req, res) => {
  try {
    const { nom, email, password, role = "superviseur", commune_id } = req.body;
    if (!nom || !email || !password || !commune_id)
      return res.status(400).json({ error: "Champs requis manquants" });

    const hash = await bcrypt.hash(password, 12);
    const { data, error } = await supabase
      .from("superviseurs")
      .insert({ id: uuidv4(), nom, email: email.toLowerCase(), password_hash: hash, role, commune_id })
      .select("id, nom, email, role")
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
authRouter.get("/me", authMiddleware, async (req, res) => {
  const { data } = await supabase
    .from("superviseurs")
    .select("id, nom, email, role, commune_id")
    .eq("id", req.user.id)
    .single();
  res.json(data);
});

// ════════════════════════════════════════════════════════════
// ROUTE : COMMUNES  (/api/communes)
// ════════════════════════════════════════════════════════════
const communesRouter = express.Router();

// GET /api/communes/detect?lat=xx&lng=yy — détecte la commune par GPS
communesRouter.get("/detect", async (req, res) => {
  try {
    const { lat, lng } = req.query;
    if (!lat || !lng)
      return res.status(400).json({ error: "lat et lng requis" });

    // Appel à l'API Adresse gouv.fr (gratuite, sans clé)
    const fetch = require("node-fetch");
    const response = await fetch(
      `https://api-adresse.data.gouv.fr/reverse/?lon=${lng}&lat=${lat}`
    );
    const geoData = await response.json();
    const feat = geoData.features?.[0];
    const cp   = feat?.properties?.postcode;
    const ville = feat?.properties?.city || feat?.properties?.municipality || "";
    const adresse = feat?.properties?.label || `${lat}, ${lng}`;

    if (!cp) return res.json({ affiliee: false, adresse, ville });

    const { data: commune } = await supabase
      .from("communes")
      .select("id, nom, couleur, actif")
      .contains("codes_postaux", [cp])
      .eq("actif", true)
      .single();

    if (!commune) {
      return res.json({ affiliee: false, adresse, ville, cp });
    }

    res.json({ affiliee: true, commune, adresse, ville, cp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/communes/:id — infos d'une commune
communesRouter.get("/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("communes")
    .select("id, nom, couleur, population, palier")
    .eq("id", req.params.id)
    .single();
  if (error) return res.status(404).json({ error: "Commune non trouvée" });
  res.json(data);
});

// ════════════════════════════════════════════════════════════
// ROUTE : SIGNALEMENTS  (/api/signalements)
// ════════════════════════════════════════════════════════════
const signalementsRouter = express.Router();

// Analyse IA de l'urgence (règles métier + mots-clés)
function analyserUrgenceIA(categorie, description) {
  const d = (description || "").toLowerCase();
  const mots = {
    voirie:    { dangereux:["trou","effondré","profond","cassé","fendu","affaissé"], genant:["dégradé","fissuré","usé"] },
    proprete:  { dangereux:["déchets","ordures","éparpillé","souillé"],             genant:["sac","poubelle","dépôt"] },
    mobilier:  { dangereux:["cassé","brisé","arraché","lame"],                      genant:["abîmé","dégradé","tagué"] },
    eclairage: { dangereux:["panne","éteint","cassé","zone sombre"],                genant:["clignote","intermittent"] },
    graffiti:  { dangereux:["école","insulte","raciste","maternelle"],              genant:["tag","inscription"] },
    autre:     { dangereux:[], genant:[] },
  };
  const cat = mots[categorie] || mots.autre;
  const sd = cat.dangereux.filter(m => d.includes(m)).length;
  const sg = cat.genant.filter(m => d.includes(m)).length;
  const defaults = { voirie:"genant", proprete:"genant", mobilier:"genant", eclairage:"genant", graffiti:"normal", autre:"normal" };

  if (sd > 0) return { urgence:"dangereux", confiance: Math.min(75 + sd * 8, 96) };
  if (sg > 0) return { urgence:"genant",    confiance: Math.min(70 + sg * 6, 90) };
  return { urgence: defaults[categorie] || "normal", confiance: 65 };
}

// POST /api/signalements — créer un signalement (citoyen)
signalementsRouter.post("/", async (req, res) => {
  try {
    const {
      commune_id, categorie, description,
      adresse, latitude, longitude,
      photo_detail_base64, photo_large_base64,
      telephone, cp
    } = req.body;

    if (!commune_id || !categorie || !latitude || !longitude)
      return res.status(400).json({ error: "Champs requis manquants" });

    // Vérifier doublon (même catégorie, même commune, rayon 50m, non résolu)
    const { data: existants } = await supabase
      .from("signalements")
      .select("id, adresse, votes, statut, latitude, longitude")
      .eq("commune_id", commune_id)
      .eq("categorie", categorie)
      .neq("statut", "resolu");

    if (existants) {
      for (const s of existants) {
        const d = distanceMetres(latitude, longitude, s.latitude, s.longitude);
        if (d <= 50) {
          return res.status(200).json({
            doublon: true,
            signalement_existant: s,
            distance: Math.round(d),
            message: "Un signalement similaire existe déjà à proximité."
          });
        }
      }
    }

    // Upload photos sur Cloudinary (ou Supabase Storage)
    let photoDetailUrl = null, photoLargeUrl  = null;
    if (photo_detail_base64) {
      photoDetailUrl = await uploadPhoto(photo_detail_base64, `detail_${Date.now()}`);
    }
    if (photo_large_base64) {
      photoLargeUrl = await uploadPhoto(photo_large_base64, `large_${Date.now()}`);
    }

    // Analyse IA urgence
    const ia = analyserUrgenceIA(categorie, description);

    const ref = "SIG-" + Date.now().toString(36).toUpperCase();

    const { data: sig, error } = await supabase
      .from("signalements")
      .insert({
        id: uuidv4(), ref,
        commune_id, categorie,
        description: description || null,
        adresse, latitude: parseFloat(latitude), longitude: parseFloat(longitude),
        photo_detail_url: photoDetailUrl,
        photo_large_url:  photoLargeUrl,
        urgence: ia.urgence,
        urgence_ia: true,
        urgence_confiance: ia.confiance,
        statut: "recu",
        telephone: telephone || null,
        votes: 0,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // SMS de confirmation si téléphone fourni
    if (telephone) {
      await envoyerSMS(telephone,
        `✅ Votre signalement ${ref} a bien été enregistré. Vous recevrez une notification lors de sa prise en charge. — MaVilleSaine`
      );
    }

    res.status(201).json({ success: true, signalement: sig });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/signalements/:id/voter — confirmer un doublon
signalementsRouter.post("/:id/voter", async (req, res) => {
  try {
    const { data: sig } = await supabase
      .from("signalements")
      .select("votes")
      .eq("id", req.params.id)
      .single();

    if (!sig) return res.status(404).json({ error: "Signalement non trouvé" });

    const { data, error } = await supabase
      .from("signalements")
      .update({ votes: (sig.votes || 0) + 1 })
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, votes: data.votes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/signalements?commune_id=&statut=&categorie=&urgence= — liste (superviseur)
signalementsRouter.get("/", authMiddleware, superviseurOnly, async (req, res) => {
  try {
    const { commune_id, statut, categorie, urgence, limit = 100, offset = 0 } = req.query;
    const cid = commune_id || req.user.commune_id;

    let query = supabase
      .from("signalements")
      .select("*", { count: "exact" })
      .eq("commune_id", cid)
      .order("created_at", { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (statut    && statut    !== "tous") query = query.eq("statut",    statut);
    if (categorie && categorie !== "tous") query = query.eq("categorie", categorie);
    if (urgence   && urgence   !== "tous") query = query.eq("urgence",   urgence);

    const { data, error, count } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ signalements: data, total: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/signalements/:id — mettre à jour statut/urgence (superviseur)
signalementsRouter.patch("/:id", authMiddleware, superviseurOnly, async (req, res) => {
  try {
    const { statut, urgence, technicien_id } = req.body;
    const updates = { updated_at: new Date().toISOString() };

    if (statut)        updates.statut        = statut;
    if (urgence)       { updates.urgence = urgence; updates.urgence_ia = false; }
    if (technicien_id) updates.technicien_id = technicien_id;

    const { data: sig, error } = await supabase
      .from("signalements")
      .update(updates)
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // SMS au citoyen si téléphone + changement de statut
    if (statut && sig.telephone) {
      const messages = {
        en_cours: `🔧 Votre signalement ${sig.ref} est en cours de traitement. — MaVilleSaine`,
        resolu:   `✅ Votre signalement ${sig.ref} a été résolu. Merci pour votre contribution ! — MaVilleSaine`,
      };
      if (messages[statut]) await envoyerSMS(sig.telephone, messages[statut]);
    }

    res.json({ success: true, signalement: sig });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/signalements/:id — détail
signalementsRouter.get("/:id", authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from("signalements")
    .select("*, techniciens(*)")
    .eq("id", req.params.id)
    .single();
  if (error) return res.status(404).json({ error: "Non trouvé" });
  res.json(data);
});

// ════════════════════════════════════════════════════════════
// ROUTE : TECHNICIENS  (/api/techniciens)
// ════════════════════════════════════════════════════════════
const techniciensRouter = express.Router();

techniciensRouter.use(authMiddleware, superviseurOnly);

// GET /api/techniciens
techniciensRouter.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("techniciens")
    .select("*")
    .eq("commune_id", req.user.commune_id)
    .order("nom");
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// POST /api/techniciens — créer
techniciensRouter.post("/", async (req, res) => {
  const { nom, specialite, telephone, email, couleur } = req.body;
  if (!nom) return res.status(400).json({ error: "Nom requis" });
  const { data, error } = await supabase
    .from("techniciens")
    .insert({ id: uuidv4(), nom, specialite, telephone, email, couleur: couleur || "#2563eb", commune_id: req.user.commune_id })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// PUT /api/techniciens/:id — modifier
techniciensRouter.put("/:id", async (req, res) => {
  const { nom, specialite, telephone, email, couleur } = req.body;
  const { data, error } = await supabase
    .from("techniciens")
    .update({ nom, specialite, telephone, email, couleur, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("commune_id", req.user.commune_id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// DELETE /api/techniciens/:id
techniciensRouter.delete("/:id", async (req, res) => {
  const { error } = await supabase
    .from("techniciens")
    .delete()
    .eq("id", req.params.id)
    .eq("commune_id", req.user.commune_id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════
// ROUTE : INTERVENTIONS  (/api/interventions)
// ════════════════════════════════════════════════════════════
const interventionsRouter = express.Router();
interventionsRouter.use(authMiddleware, superviseurOnly);

// POST /api/interventions — générer un bon d'intervention
interventionsRouter.post("/", async (req, res) => {
  try {
    const { signalement_id, technicien_id, notes } = req.body;

    const { data: sig } = await supabase
      .from("signalements")
      .select("*, techniciens(*)")
      .eq("id", signalement_id)
      .single();

    if (!sig) return res.status(404).json({ error: "Signalement non trouvé" });

    const ref_intervention = "INT-" + Date.now().toString(36).toUpperCase();

    const { data: intervention, error } = await supabase
      .from("interventions")
      .insert({
        id: uuidv4(),
        ref: ref_intervention,
        signalement_id,
        technicien_id: technicien_id || null,
        commune_id: req.user.commune_id,
        superviseur_id: req.user.id,
        notes: notes || null,
        statut: "emis",
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Passer le signalement en "en_cours"
    await supabase
      .from("signalements")
      .update({ statut: "en_cours", technicien_id, updated_at: new Date().toISOString() })
      .eq("id", signalement_id);

    res.status(201).json({ success: true, intervention, signalement: sig });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/interventions
interventionsRouter.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("interventions")
    .select("*, signalements(ref, adresse, categorie, urgence), techniciens(nom)")
    .eq("commune_id", req.user.commune_id)
    .order("created_at", { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// ════════════════════════════════════════════════════════════
// ROUTE : STATS  (/api/stats)
// ════════════════════════════════════════════════════════════
const statsRouter = express.Router();
statsRouter.use(authMiddleware, superviseurOnly);

// GET /api/stats — tableau de bord
statsRouter.get("/", async (req, res) => {
  try {
    const cid = req.user.commune_id;
    const now = new Date();
    const debut_mois = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [total, recu, en_cours, resolu, danger, mois] = await Promise.all([
      supabase.from("signalements").select("id", { count: "exact", head: true }).eq("commune_id", cid),
      supabase.from("signalements").select("id", { count: "exact", head: true }).eq("commune_id", cid).eq("statut", "recu"),
      supabase.from("signalements").select("id", { count: "exact", head: true }).eq("commune_id", cid).eq("statut", "en_cours"),
      supabase.from("signalements").select("id", { count: "exact", head: true }).eq("commune_id", cid).eq("statut", "resolu"),
      supabase.from("signalements").select("id", { count: "exact", head: true }).eq("commune_id", cid).eq("urgence", "dangereux").neq("statut", "resolu"),
      supabase.from("signalements").select("id", { count: "exact", head: true }).eq("commune_id", cid).gte("created_at", debut_mois),
    ]);

    // Répartition par catégorie
    const { data: parCategorie } = await supabase
      .from("signalements")
      .select("categorie")
      .eq("commune_id", cid);

    const categories = {};
    (parCategorie || []).forEach(s => {
      categories[s.categorie] = (categories[s.categorie] || 0) + 1;
    });

    res.json({
      total:    total.count || 0,
      recu:     recu.count || 0,
      en_cours: en_cours.count || 0,
      resolu:   resolu.count || 0,
      danger:   danger.count || 0,
      ce_mois:  mois.count || 0,
      categories,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════

function distanceMetres(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function envoyerSMS(to, message) {
  try {
    if (!process.env.TWILIO_ACCOUNT_SID) return; // SMS désactivé si pas configuré
    const twilio = require("twilio")(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const tel = to.replace(/\s/g, "").replace(/^0/, "+33");
    await twilio.messages.create({ body: message, from: process.env.TWILIO_PHONE_NUMBER, to: tel });
  } catch (err) {
    console.error("[SMS ERROR]", err.message);
  }
}

async function uploadPhoto(base64, filename) {
  try {
    // Upload sur Supabase Storage (simple, gratuit jusqu'à 1GB)
    const buffer = Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ""), "base64");
    const { data, error } = await supabase.storage
      .from("photos")
      .upload(`signalements/${filename}.jpg`, buffer, { contentType: "image/jpeg", upsert: true });
    if (error) throw error;
    const { data: url } = supabase.storage.from("photos").getPublicUrl(`signalements/${filename}.jpg`);
    return url.publicUrl;
  } catch (err) {
    console.error("[UPLOAD ERROR]", err.message);
    return null;
  }
}

// ── Exports ───────────────────────────────────────────────────
module.exports = {
  authRouter,
  communesRouter,
  signalementsRouter,
  techniciensRouter,
  interventionsRouter,
  statsRouter,
};
