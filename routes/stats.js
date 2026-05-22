const express = require("express");
const router = express.Router();
const { supabase } = require("./supabase");

router.get("/", async (req, res) => {
  try {
    const { commune_id } = req.query;
    let query = supabase.from("signalements").select("id, statut, categorie, urgence, created_at", { count: "exact" });
    if (commune_id) query = query.eq("commune_id", commune_id);
    const { data, count, error } = await query;
    if (error) return res.status(400).json({ error: error.message });

    const now = new Date();
    const debutMois = new Date(now.getFullYear(), now.getMonth(), 1);

    const stats = {
      total: count || 0,
      recu: (data||[]).filter(s=>s.statut==="recu").length,
      en_cours: (data||[]).filter(s=>s.statut==="en_cours").length,
      resolu: (data||[]).filter(s=>s.statut==="resolu").length,
      danger: (data||[]).filter(s=>s.urgence==="dangereux" && s.statut!=="resolu").length,
      ce_mois: (data||[]).filter(s=>s.created_at && new Date(s.created_at) >= debutMois).length,
    };
    res.json(stats);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
