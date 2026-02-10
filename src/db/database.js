import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../../vahan.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'pending',
    input_file_path TEXT,
    input_file_name TEXT,
    output_file_path TEXT,
    total_vehicles INTEGER DEFAULT 0,
    processed_vehicles INTEGER DEFAULT 0,
    successful_extractions INTEGER DEFAULT 0,
    failed_extractions INTEGER DEFAULT 0,
    error_message TEXT
  );

  CREATE TABLE IF NOT EXISTS vehicle_results (
    id TEXT PRIMARY KEY,
    job_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    vehicle_number TEXT,
    success INTEGER DEFAULT 0,
    error_message TEXT,
    maker TEXT,
    maker_model TEXT,
    vehicle_type TEXT,
    vehicle_class TEXT,
    vehicle_category TEXT,
    seating_capacity TEXT,
    unladen_weight TEXT,
    laden_weight TEXT,
    sld_status TEXT,
    speed_governor_number TEXT,
    speed_governor_manufacturer TEXT,
    speed_governor_type TEXT,
    speed_governor_approval_no TEXT,
    speed_governor_test_report_no TEXT,
    speed_governor_fitment_cert_no TEXT,
    permit_status TEXT,
    permit_type TEXT,
    permit_category TEXT,
    service_type TEXT,
    office TEXT,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
  );
`);

export default db;
