const express = require("express");
const router  = express.Router();
const bcrypt  = require("bcryptjs");
const { supabase } = require("./supabase");

// Middleware vérification token admin
const jwt = require("jsonwebtoken");
const requireAdmin = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Non autorisé" });
  try {
    const decoded = jwt.verify(auth.replace("Bearer ",""), process.env.JWT_SECRET);
    if (decoded.role !== "admin") return res.status(403).json({ error: "Réservé à l'admin" });
    req.user = decoded;
    next();
  } catch { return res.status(401).json({ error: "Token invalide" }); }
};

// GET /api/superviseurs — liste tous les superviseurs
router.get("/", requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("superviseurs")
      .select("id, nom, email, role, commune_id, communes(nom)")
      .order("nom");
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/superviseurs — créer un superviseur
router.post("/", requireAdmin, async (req, res) => {
  const { nom, email, password, commune_id } = req.body;
  if (!nom || !email || !password) 
    return res.status(400).json({ error: "nom, email et password requis" });
  try {
    const password_hash = await bcrypt.hash(password, 10);
    const { data, error } = await supabase
      .from("superviseurs")
      .insert([{ nom, email, password_hash, commune_id: commune_id || null, role: "superviseur" }])
      .select("id, nom, email, role, commune_id")
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/superviseurs/:id — supprimer un superviseur
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from("superviseurs")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
