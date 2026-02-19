const express = require("express");
const { signup, signin, me, logout } = require("./auth.controller");

const router = express.Router();

router.post("/signup", signup);
router.post("/signin", signin);
router.get("/me", me);
router.post("/logout", logout);

module.exports = router;
