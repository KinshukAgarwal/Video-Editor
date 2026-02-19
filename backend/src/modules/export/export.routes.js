const express = require("express");
const {
    createExport,
    getStatus,
    downloadExport,
} = require("./export.controller");

const router = express.Router();

function requireAuth(req, res, next) {
    if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
    }
    return next();
}

router.post("/", requireAuth, createExport);
router.get("/:exportId/status", requireAuth, getStatus);
router.get("/:exportId/download", requireAuth, downloadExport);

module.exports = router;
