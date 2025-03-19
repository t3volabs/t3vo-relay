const express = require("express");
const BetterSqlite3 = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const morgan = require("morgan");

const app = express();
const PORT = 57301;
const dataDir = path.join(process.cwd(), "data");
const dbFile = path.join(dataDir, "storage.db");

let dayx = 30;

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new BetterSqlite3(dbFile);

db.exec(`
  CREATE TABLE IF NOT EXISTS objects (
    objectId TEXT PRIMARY KEY, 
    userId TEXT NOT NULL,
    entry BLOB NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

const deleteOldEntries = () => {
  const now = Date.now();
  const tenDaysAgo = now - dayx * 24 * 60 * 60 * 1000;

  db.prepare("DELETE FROM objects WHERE created_at < ?").run(tenDaysAgo);
};

const hashUserId = (userId) => crypto.createHash("sha256").update(userId).digest("hex");

setInterval(deleteOldEntries, 24 * 60 * 60 * 1000);

app.use(morgan("combined"));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.use(express.json({ limit: "10mb" }));

app.get("/server/", (req, res) => {
  try {
    const totalRecords = db.prepare("SELECT COUNT(*) AS count FROM objects").get().count;
    const uniqueUsers = db.prepare("SELECT COUNT(DISTINCT userId) AS count FROM objects").get().count;
    const totalDataSize = db.prepare("SELECT COALESCE(SUM(LENGTH(entry)), 0) AS size FROM objects").get().size || 0;
    const lastEntry = db.prepare("SELECT created_at FROM objects ORDER BY created_at DESC LIMIT 1").get();
    const lastUpdatedAt = lastEntry ? new Date(lastEntry.created_at).toISOString() : null;

    res.json({
      status: "ok",
      records: totalRecords,
      users: uniqueUsers,
      dataSizeBytes: totalDataSize,
      retentionDays: dayx,
      lastUpdatedAt,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Error fetching server status:", err);
    res.status(500).json({ status: "error", message: "Failed to retrieve server stats" });
  }
});

app.post("/save/:userId", (req, res) => {
  try {
    const { userId } = req.params;
    const hashedUserId = hashUserId(userId);
    const data = JSON.stringify(req.body);

    if (!data || data.length === 0) {
      throw new Error("Data is empty or malformed");
    }

    const objectId = hashUserId(data + hashedUserId);
    const now = Date.now();

    db.prepare("INSERT OR REPLACE INTO objects (objectId, userId, entry, created_at) VALUES (?, ?, ?, ?)").run(objectId, hashedUserId, data, now);

    res.json({ success: true, objectId, expiresAt: new Date(now + 25 * 24 * 60 * 60 * 1000) });
  } catch (err) {
    console.error("Error storing object:", err);
    res.status(500).json({ error: "Failed to store object" });
  }
});

app.get("/fetch/:userId/:page", (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.params.page, 10) || 1; // Convert to integer, default to 1 if invalid
    const hashedUserId = hashUserId(userId);
    const limit = 30;
    const offset = (page - 1) * limit;

    const totalCount = db.prepare("SELECT COUNT(*) AS count FROM objects WHERE userId = ?").get(hashedUserId).count;
    const objects = db.prepare("SELECT entry FROM objects WHERE userId = ? ORDER BY created_at DESC LIMIT ? OFFSET ?").all(hashedUserId, limit, offset);

    if (!objects.length) return res.status(404).json({ error: "No data found" });

    res.json({
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit),
      totalCount,
      hasNextPage: offset + limit < totalCount,
      hasPreviousPage: page > 1,
      data: objects.map((obj) => JSON.parse(obj.entry)),
    });
  } catch (err) {
    console.error("Error fetching objects:", err);
    res.status(500).json({ error: "Failed to fetch objects" });
  }
});

app.use(express.static("public"));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
