const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { supabase } = require("../supabase");

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email et mot de passe requis" });

    const { data: user, error } = await supabase
      .from("superviseurs")
      .select("*")
      .eq("email", email.toLowerCase())
      .eq("actif", true)
      .single();

    if (error || !user) return res.status(401).json({ error: "Identifiants incorrects" });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Identifiants incorrects" });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, commune_id: user.commune_id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token, user: { id: user.id, nom: user.nom, email: user.email, role: user.role, commune_id: user.commune_id } });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post("/fcm-token", async (req, res) => {
  try {
    const { superviseur_id, fcm_token } = req.body;
    await supabase.from("superviseurs").update({ fcm_token }).eq("id", superviseur_id);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
