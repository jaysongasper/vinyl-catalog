const express = require("express");
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

async function ensureDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS records (
      id BIGSERIAL PRIMARY KEY,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      year INTEGER,
      genre TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE records ADD COLUMN IF NOT EXISTS artist TEXT;
    ALTER TABLE records ADD COLUMN IF NOT EXISTS album TEXT;
    ALTER TABLE records ADD COLUMN IF NOT EXISTS year INTEGER;
    ALTER TABLE records ADD COLUMN IF NOT EXISTS genre TEXT;
    ALTER TABLE records ADD COLUMN IF NOT EXISTS notes TEXT;
    ALTER TABLE records ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE records ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    CREATE INDEX IF NOT EXISTS idx_records_artist ON records(artist);
    CREATE INDEX IF NOT EXISTS idx_records_album ON records(album);
    CREATE INDEX IF NOT EXISTS idx_records_year ON records(year);
    CREATE INDEX IF NOT EXISTS idx_records_genre ON records(genre);
  `);
}

function parseCSV(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = lines.shift().split(",").map(s => s.trim());
  return lines.map(line => {
    const out = [];
    let cur = "", quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === "," && !quoted) {
        out.push(cur); cur = "";
      } else cur += ch;
    }
    out.push(cur);
    const obj = {};
    headers.forEach((h, i) => obj[h] = out[i] ?? "");
    return obj;
  });
}

async function syncCSV() {
  const csvPath = path.join(__dirname, "data", "vinyl_catalog.csv");
  const records = parseCSV(fs.readFileSync(csvPath, "utf8"));
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const r of records) {
      await client.query(`
        INSERT INTO records (artist, album, year, genre, notes)
        SELECT $1, $2, $3, $4, $5
        WHERE NOT EXISTS (
          SELECT 1 FROM records
          WHERE LOWER(artist) = LOWER($1)
            AND LOWER(album) = LOWER($2)
            AND year IS NOT DISTINCT FROM $3
        )
      `, [
        r.Artist.trim(),
        r.Album.trim(),
        r.Year ? Number(r.Year) : null,
        r.Genre?.trim() || null,
        r.Notes?.trim() || null
      ]);
    }

    await client.query("COMMIT");
    console.log(`CSV sync complete: ${records.length} catalog records checked.`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

app.get("/api/records", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM records
      ORDER BY LOWER(REGEXP_REPLACE(artist, '^(The |A )', '')), LOWER(album)
    `);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Unable to load records" });
  }
});

app.post("/api/records", async (req, res) => {
  const { artist, album, year, genre, notes } = req.body;
  if (!artist?.trim() || !album?.trim())
    return res.status(400).json({ error: "Artist and album are required" });

  try {
    const { rows } = await pool.query(`
      INSERT INTO records (artist, album, year, genre, notes)
      VALUES ($1,$2,$3,$4,$5) RETURNING *
    `, [
      artist.trim(), album.trim(), year ? Number(year) : null,
      genre?.trim() || null, notes?.trim() || null
    ]);
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Unable to add record" });
  }
});

app.put("/api/records/:id", async (req, res) => {
  const { artist, album, year, genre, notes } = req.body;
  if (!artist?.trim() || !album?.trim())
    return res.status(400).json({ error: "Artist and album are required" });

  try {
    const { rows } = await pool.query(`
      UPDATE records
      SET artist=$1, album=$2, year=$3, genre=$4, notes=$5, updated_at=NOW()
      WHERE id=$6 RETURNING *
    `, [
      artist.trim(), album.trim(), year ? Number(year) : null,
      genre?.trim() || null, notes?.trim() || null, req.params.id
    ]);
    if (!rows.length) return res.status(404).json({ error: "Record not found" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Unable to update record" });
  }
});

app.delete("/api/records/:id", async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM records WHERE id=$1", [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Record not found" });
    res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Unable to delete record" });
  }
});

app.get("/{*splat}", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

(async () => {
  try {
    await ensureDatabase();
    await syncCSV();
    app.listen(PORT, () => console.log(`Vinyl collection listening on ${PORT}`));
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
