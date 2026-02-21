// Database service — SQLite via better-sqlite3
// Singleton connection with auto-schema initialization

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'database', 'nihongo.db');

// Ensure the database directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Create database connection (singleton)
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Run schema on first connect
const schemaPath = path.join(__dirname, '..', '..', 'database', 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf-8');
db.exec(schema);

module.exports = db;
