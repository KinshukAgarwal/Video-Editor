const express = require("express");
const {
  getCurrentProject,
  updateCurrentProject,
} = require("./projects.controller");

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  return next();
}

router.get("/current", requireAuth, getCurrentProject);
router.put("/current", requireAuth, updateCurrentProject);

module.exports = router;
