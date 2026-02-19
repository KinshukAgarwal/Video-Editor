const express = require("express");
const { generate } = require("./subtitles.controller");

const router = express.Router();

function requireAuth(req, res, next) {
    if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
    }
    return next();
}

router.post("/generate", requireAuth, generate);

module.exports = router;
