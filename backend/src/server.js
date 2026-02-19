const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const session = require("express-session");
const MongoStoreModule = require("connect-mongo");

require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const authRoutes = require("./modules/auth/auth.routes");
const projectRoutes = require("./modules/projects/projects.routes");
const mediaRoutes = require("./modules/media/media.routes");
const subtitleRoutes = require("./modules/subtitles/subtitles.routes");
const exportRoutes = require("./modules/export/export.routes");

const app = express();
const port = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === "production";
const MongoStore = MongoStoreModule.default || MongoStoreModule;
const allowedOrigins = new Set(
  String(process.env.FRONTEND_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
allowedOrigins.add("http://localhost:5173");
allowedOrigins.add("http://127.0.0.1:5173");
allowedOrigins.add("null");

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.has(origin) || origin.startsWith("file://")) {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(
  session({
    name: "sid",
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      collectionName: "sessions",
    }),
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

app.get("/", (_req, res) => {
  res.status(200).json({ message: "Backend is running" });
});

app.use("/api/auth", authRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/subtitles", subtitleRoutes);
app.use("/api/export", exportRoutes);

async function startServer() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`[db] connected to ${mongoose.connection.name}`);
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start backend:", error.message);
  process.exit(1);
});
