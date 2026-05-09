const express = require("express");
const router = express.Router();
const { supabase } = require("./supabase");

router.get("/detect", async (req, res) => {
  try {
    const { lat, lng } = req.query;
    const { data, error } = await supabase.from("communes").select("*").eq("actif", true);
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase.from("communes").select("*").eq("actif", true).order("nom");
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
