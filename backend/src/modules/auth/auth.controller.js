const {
  createUser,
  authenticateUser,
  getUserById,
} = require("./auth.service");

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateAuthFields({ name, email, password }, requireName = false) {
  if (requireName && (!name || typeof name !== "string" || !name.trim())) {
    return { message: "Name is required", field: "name" };
  }

  if (!email || typeof email !== "string" || !email.trim()) {
    return { message: "Email is required", field: "email" };
  }

  if (!isValidEmail(email.trim())) {
    return { message: "Please enter a valid email", field: "email" };
  }

  if (!password || typeof password !== "string" || password.length < 6) {
    return {
      message: "Password must be at least 6 characters",
      field: "password",
    };
  }

  return null;
}

async function signup(req, res) {
  try {
    const validationError = validateAuthFields(req.body, true);
    if (validationError) {
      return res.status(400).json(validationError);
    }

    const result = await createUser(req.body);
    if (result.error) {
      return res
        .status(result.status)
        .json({ message: result.error, field: result.field });
    }

    req.session.userId = result.user.id;
    console.log(`[auth] signup success for ${result.user.email}`);
    return res.status(result.status).json({ user: result.user });
  } catch (error) {
    console.error("[auth] signup failed:", error.message);
    return res.status(500).json({ message: "Signup failed. Try again." });
  }
}

async function signin(req, res) {
  try {
    const validationError = validateAuthFields(req.body, false);
    if (validationError) {
      return res.status(400).json(validationError);
    }

    const result = await authenticateUser(req.body);
    if (result.error) {
      return res
        .status(result.status)
        .json({ message: result.error, field: result.field });
    }

    req.session.userId = result.user.id;
    console.log(`[auth] signin success for ${result.user.email}`);
    return res.status(200).json({ user: result.user });
  } catch (error) {
    console.error("[auth] signin failed:", error.message);
    return res.status(500).json({ message: "Signin failed. Try again." });
  }
}

async function me(req, res) {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const user = await getUserById(req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ message: "Session expired" });
    }

    return res.status(200).json({ user });
  } catch (error) {
    console.error("[auth] me failed:", error.message);
    return res.status(500).json({ message: "Failed to verify session" });
  }
}

function logout(req, res) {
  req.session.destroy((error) => {
    if (error) {
      console.error("[auth] logout failed:", error.message);
      return res.status(500).json({ message: "Logout failed" });
    }

    res.clearCookie("sid");
    return res.status(200).json({ message: "Logged out" });
  });
}

module.exports = {
  signup,
  signin,
  me,
  logout,
};
