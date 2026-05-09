const express = require("express");
const router = express.Router();
const { supabase } = require("./supabase");

router.get("/", async (req, res) => {
  try {
    const { commune_id } = req.query;
    let query = supabase.from("techniciens").select("*").eq("actif", true).order("nom");
    if (commune_id) query = query.eq("commune_id", commune_id);
    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
