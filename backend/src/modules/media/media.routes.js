const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const { upload } = require("./media.controller");

const router = express.Router();

const TEMP_DIR = path.resolve(__dirname, "../../../../storage/uploads/_tmp");
fs.mkdirSync(TEMP_DIR, { recursive: true });
const uploadHandler = multer({ dest: TEMP_DIR });

function requireAuth(req, res, next) {
    if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
    }
    return next();
}

router.post("/upload", requireAuth, uploadHandler.single("file"), upload);

module.exports = router;
