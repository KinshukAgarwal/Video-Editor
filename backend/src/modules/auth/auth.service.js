const bcrypt = require("bcryptjs");
const AuthUser = require("./auth.model");

const SALT_ROUNDS = 10;

function sanitizeUser(userDoc) {
  return {
    id: userDoc._id.toString(),
    name: userDoc.name,
    email: userDoc.email,
  };
}

async function createUser({ name, email, password }) {
  const normalizedEmail = String(email).toLowerCase().trim();

  const existingUser = await AuthUser.findOne({ email: normalizedEmail });
  if (existingUser) {
    return {
      error: "This email is already registered",
      field: "email",
      status: 409,
    };
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await AuthUser.create({
    name: String(name).trim(),
    email: normalizedEmail,
    passwordHash,
  });

  return { user: sanitizeUser(user), status: 201 };
}

async function authenticateUser({ email, password }) {
  const normalizedEmail = String(email).toLowerCase().trim();
  const user = await AuthUser.findOne({ email: normalizedEmail });

  if (!user) {
    return {
      error: "No account found for this email",
      field: "email",
      status: 401,
    };
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    return {
      error: "Incorrect password",
      field: "password",
      status: 401,
    };
  }

  return { user: sanitizeUser(user), status: 200 };
}

async function getUserById(userId) {
  const user = await AuthUser.findById(userId);
  if (!user) {
    return null;
  }

  return sanitizeUser(user);
}

module.exports = {
  createUser,
  authenticateUser,
  getUserById,
};
