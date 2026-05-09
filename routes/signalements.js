const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const { supabase } = require("../server");

router.post("/", async (req, res) => {
  try {
    const { commune_id, adresse, latitude, longitude, categorie, description, photo_detail_url, photo_large_url, urgence, fcm_token } = req.body;
    const ref = "SIG-" + Math.random().toString(36).substring(2,8).toUpperCase();
    const { data, error } = await supabase.from("signalements").insert({
      id: uuidv4(), ref, commune_id, adresse, latitude, longitude, categorie,
      description, photo_detail_url, photo_large_url, urgence: urgence||"normal", fcm_token, statut: "recu"
    }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ signalement: data });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get("/", async (req, res) => {
  try {
    const { commune_id } = req.query;
    let query = supabase.from("signalements").select("*").order("created_at", { ascending: false });
    if (commune_id) query = query.eq("commune_id", commune_id);
    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.put("/:id", async (req, res) => {
  try {
    const { statut, technicien_id } = req.body;
    const { data, error } = await supabase.from("signalements").update({ statut, technicien_id, updated_at: new Date().toISOString() }).eq("id", req.params.id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
