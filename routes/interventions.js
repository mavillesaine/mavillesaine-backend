const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const { supabase } = require("./supabase");

router.post("/", async (req, res) => {
  try {
    const { signalement_id, technicien_id, commune_id, superviseur_id, notes } = req.body;
    const ref = "INT-" + Math.random().toString(36).substring(2,8).toUpperCase();
    const { data, error } = await supabase.from("interventions").insert({
      id: uuidv4(), ref, signalement_id, technicien_id, commune_id, superviseur_id, notes, statut: "emis"
    }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
