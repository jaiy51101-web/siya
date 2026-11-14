import express from "express";
import path from "path";
import crypto from "crypto";
import Database from "better-sqlite3";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const db = new Database(process.env.DATABASE_PATH || "siya.db");
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
  CREATE TABLE IF NOT EXISTS auth_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    event TEXT NOT NULL,
    ip TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_auth_logs_created_at ON auth_logs(created_at);
  CREATE TABLE IF NOT EXISTS user_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    sender TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_user_conversations_user_id ON user_conversations(user_id);
`);

const app = express();
app.use(express.json({ limit: "1mb" }));

const cleanEmail = (email: string) => email.trim().toLowerCase();
const DEV_EMAILS = [
  cleanEmail(process.env.DEVELOPER_EMAIL || ""),
  "shivu12745114@gmail.com",
  "shivamt2phone@gmail.com",
  "areels491@gmail.com",
  "sy1995740@gmail.com",
].filter(Boolean);
const isDeveloperEmail = (email: string) => DEV_EMAILS.includes(cleanEmail(email));

// Seed existing users into auth_logs if empty so historical activity is preserved
try {
  const logCount = (db.prepare(`SELECT COUNT(*) as c FROM auth_logs`).get() as any).c;
  if (logCount === 0) {
    const existingUsers = db.prepare(`SELECT id, name, email, created_at, last_login_at FROM users`).all() as any[];
    for (const u of existingUsers) {
      db.prepare(`INSERT INTO auth_logs (user_id, name, email, event, ip, created_at) VALUES (?, ?, ?, 'signup', 'Account Created', ?)`).run(u.id, u.name, u.email, u.created_at || new Date().toISOString());
      if (u.last_login_at) {
        db.prepare(`INSERT INTO auth_logs (user_id, name, email, event, ip, created_at) VALUES (?, ?, ?, 'login', 'Logged in', ?)`).run(u.id, u.name, u.email, u.last_login_at);
      }
    }
  }
} catch (e) {
  console.error("Failed to seed auth logs", e);
}
const hashPassword = (password: string, salt = crypto.randomBytes(16).toString("hex")) => ({
  salt,
  hash: crypto.scryptSync(password, salt, 64).toString("hex"),
});
const verifyPassword = (password: string, salt: string, expected: string) => {
  const actual = crypto.scryptSync(password, salt, 64);
  const target = Buffer.from(expected, "hex");
  return actual.length === target.length && crypto.timingSafeEqual(actual, target);
};
const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const makeToken = () => crypto.randomBytes(32).toString("base64url");

function cookieOptions(maxAge = SESSION_TTL_MS) {
  return `HttpOnly; Path=/; SameSite=None; Secure; Max-Age=${Math.floor(maxAge / 1000)}`;
}
function getToken(req: express.Request) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  const customHeader = req.headers["x-siya-session"] as string;
  if (customHeader) {
    return customHeader.trim();
  }
  const raw = req.headers.cookie || "";
  const match = raw.match(/(?:^|;\s*)siya_session=([^;]+)/);
  return match?.[1] || null;
}
function getUserFromRequest(req: express.Request) {
  const token = getToken(req);
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.name, u.email, u.created_at, u.last_login_at, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(hashToken(token), Date.now()) as any;
  return row || null;
}
function createSession(res: express.Response, userId: number) {
  const token = makeToken();
  db.prepare(`INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), userId, hashToken(token), Date.now() + SESSION_TTL_MS, Date.now());
  res.setHeader("Set-Cookie", `siya_session=${token}; ${cookieOptions()}`);
  return token;
}
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  (req as any).user = user;
  next();
}

function ensureDeveloperAccount() {
  const email = cleanEmail(process.env.DEVELOPER_EMAIL || "");
  const password = String(process.env.DEVELOPER_PASSWORD || "");
  if (!email || password.length < 8) return;
  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email) as any;
  if (!existing) {
    const { salt, hash } = hashPassword(password);
    db.prepare(`INSERT INTO users (name, email, password_hash, password_salt) VALUES (?, ?, ?, ?)` )
      .run("Developer", email, hash, salt);
  }
}
ensureDeveloperAccount();
function requireDeveloper(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = getUserFromRequest(req);
  if (!user || !isDeveloperEmail(user.email)) {
    return res.status(403).json({ error: "Developer access denied" });
  }
  (req as any).user = user;
  next();
}

app.post("/api/auth/signup", (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = cleanEmail(String(req.body?.email || ""));
  const password = String(req.body?.password || "");
  if (name.length < 2 || name.length > 60) return res.status(400).json({ error: "Enter a valid name" });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter a valid email" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  try {
    const { salt, hash } = hashPassword(password);
    const result = db.prepare(`INSERT INTO users (name, email, password_hash, password_salt) VALUES (?, ?, ?, ?)`)
      .run(name, email, hash, salt);
    const userId = Number(result.lastInsertRowid);
    const token = createSession(res, userId);

    const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "Direct";
    db.prepare(`INSERT INTO auth_logs (user_id, name, email, event, ip) VALUES (?, ?, ?, 'signup', ?)`).run(userId, name, email, clientIp);

    res.json({ user: { id: userId, name, email }, developer: isDeveloperEmail(email), token });
  } catch (error: any) {
    if (String(error?.message).includes("UNIQUE")) return res.status(409).json({ error: "An account with this email already exists" });
    console.error(error);
    res.status(500).json({ error: "Could not create account" });
  }
});

app.post("/api/auth/login", (req, res) => {
  const email = cleanEmail(String(req.body?.email || ""));
  const password = String(req.body?.password || "");
  const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as any;
  if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  db.prepare(`UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?`).run(user.id);
  const token = createSession(res, user.id);

  const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "Direct";
  db.prepare(`INSERT INTO auth_logs (user_id, name, email, event, ip) VALUES (?, ?, ?, 'login', ?)`).run(user.id, user.name, user.email, clientIp);

  res.json({ user: { id: user.id, name: user.name, email: user.email }, developer: isDeveloperEmail(user.email), token });
});

app.post("/api/auth/logout", (req, res) => {
  const token = getToken(req);
  if (token) db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(hashToken(token));
  res.setHeader("Set-Cookie", `siya_session=; ${cookieOptions(0)}`);
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, user: { id: user.id, name: user.name, email: user.email }, developer: isDeveloperEmail(user.email) });
});

app.post("/api/developer/verify-access", (req, res) => {
  const email = cleanEmail(String(req.body?.email || ""));
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(400).json({ error: "Developer ID and password are required" });
  }

  if (!isDeveloperEmail(email)) {
    return res.status(403).json({ error: "Access denied: This ID is not an authorized developer account" });
  }

  const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as any;
  if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
    return res.status(401).json({ error: "Incorrect ID or password" });
  }

  const token = createSession(res, user.id);

  const totalUsers = (db.prepare(`SELECT COUNT(*) as count FROM users`).get() as any).count;
  const activeSessions = (db.prepare(`SELECT COUNT(*) as count FROM sessions WHERE expires_at > ?`).get(Date.now()) as any).count;
  const totalSignups = (db.prepare(`SELECT COUNT(*) as count FROM auth_logs WHERE event = 'signup'`).get() as any).count;
  const totalLogins = (db.prepare(`SELECT COUNT(*) as count FROM auth_logs WHERE event = 'login'`).get() as any).count;
  const logs = db.prepare(`SELECT * FROM auth_logs ORDER BY id DESC LIMIT 50`).all();
  const users = db.prepare(`SELECT id, name, email, created_at, last_login_at FROM users ORDER BY id DESC`).all();

  res.json({
    ok: true,
    token,
    user: { id: user.id, name: user.name, email: user.email },
    stats: { totalUsers, activeSessions, totalSignups, totalLogins },
    logs,
    users,
  });
});

app.get("/api/developer/overview", requireDeveloper, (req, res) => {
  const totalUsers = (db.prepare(`SELECT COUNT(*) as count FROM users`).get() as any).count;
  const activeSessions = (db.prepare(`SELECT COUNT(*) as count FROM sessions WHERE expires_at > ?`).get(Date.now()) as any).count;
  const totalSignups = (db.prepare(`SELECT COUNT(*) as count FROM auth_logs WHERE event = 'signup'`).get() as any).count;
  const totalLogins = (db.prepare(`SELECT COUNT(*) as count FROM auth_logs WHERE event = 'login'`).get() as any).count;
  const allUsers = db.prepare(`SELECT id, name, email, created_at, last_login_at FROM users ORDER BY id DESC`).all();
  const recentUsers = allUsers.slice(0, 12);
  const recentLogs = db.prepare(`SELECT * FROM auth_logs ORDER BY id DESC LIMIT 25`).all();
  res.json({ stats: { totalUsers, activeSessions, totalSignups, totalLogins }, allUsers, recentUsers, recentLogs });
});

app.get("/api/developer/logs", requireDeveloper, (req, res) => {
  const limit = Math.min(Number(req.query.limit || 50), 100);
  const sinceId = Number(req.query.sinceId || 0);
  let logs;
  if (sinceId > 0) {
    logs = db.prepare(`SELECT * FROM auth_logs WHERE id > ? ORDER BY id DESC LIMIT ?`).all(sinceId, limit);
  } else {
    logs = db.prepare(`SELECT * FROM auth_logs ORDER BY id DESC LIMIT ?`).all(limit);
  }
  const totalSignups = (db.prepare(`SELECT COUNT(*) as count FROM auth_logs WHERE event = 'signup'`).get() as any).count;
  const totalLogins = (db.prepare(`SELECT COUNT(*) as count FROM auth_logs WHERE event = 'login'`).get() as any).count;
  const totalUsers = (db.prepare(`SELECT COUNT(*) as count FROM users`).get() as any).count;
  const activeSessions = (db.prepare(`SELECT COUNT(*) as count FROM sessions WHERE expires_at > ?`).get(Date.now()) as any).count;
  res.json({ logs, stats: { totalUsers, activeSessions, totalSignups, totalLogins } });
});

app.get("/api/developer/users", requireDeveloper, (req, res) => {
  const users = db.prepare(`SELECT id, name, email, created_at, last_login_at FROM users ORDER BY id DESC`).all();
  res.json({ users });
});

app.get("/api/chat/messages", requireAuth, (req, res) => {
  const user = (req as any).user;
  const rows = db.prepare(`SELECT id, sender, text, created_at FROM user_conversations WHERE user_id = ? ORDER BY id ASC LIMIT 150`).all(user.id) as any[];
  res.json({
    messages: rows.map(r => ({
      id: String(r.id),
      sender: r.sender,
      text: r.text,
      createdAt: r.created_at
    }))
  });
});

app.post("/api/chat/messages", requireAuth, (req, res) => {
  const user = (req as any).user;
  const sender = req.body?.sender === "siya" ? "siya" : "user";
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Text is required" });
  const result = db.prepare(`INSERT INTO user_conversations (user_id, sender, text) VALUES (?, ?, ?)`).run(user.id, sender, text);
  res.json({ ok: true, id: String(result.lastInsertRowid) });
});

app.delete("/api/chat/messages", requireAuth, (req, res) => {
  const user = (req as any).user;
  db.prepare(`DELETE FROM user_conversations WHERE user_id = ?`).run(user.id);
  res.json({ ok: true });
});

app.get("/api/config", (req, res) => {
  res.json({ apiKey: process.env.GEMINI_API_KEY });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }
  app.listen(PORT, "0.0.0.0", () => console.log(`Server running on http://localhost:${PORT}`));
}

startServer();
