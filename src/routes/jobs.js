import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';
import db from '../db/database.js';
import { jobManager } from '../services/jobManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

// Create job (file upload handled by multer in main)
router.post('/', (req, res) => {
  if (!req.file) {
    return res.status(400).json({ detail: 'No file uploaded' });
  }

  const file = req.file;
  if (!file.originalname.endsWith('.xlsx') && !file.originalname.endsWith('.xls')) {
    fs.unlinkSync(file.path);
    return res.status(400).json({ detail: 'File must be an Excel file (.xlsx or .xls)' });
  }

  try {
    const workbook = XLSX.read(fs.readFileSync(file.path));
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);

    if (!data.length || !data[0].hasOwnProperty('vehicle_number')) {
      fs.unlinkSync(file.path);
      return res.status(400).json({ detail: "Excel file must have a 'vehicle_number' column" });
    }

    const totalVehicles = data.filter(row => row.vehicle_number).length;
    const jobId = uuidv4();

    db.prepare(`
      INSERT INTO jobs (id, input_file_path, input_file_name, total_vehicles, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).run(jobId, file.path, file.originalname, totalVehicles);

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    res.json(job);
  } catch (e) {
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    res.status(400).json({ detail: `Failed to read Excel file: ${e.message}` });
  }
});

// List jobs
router.get('/', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = Math.min(parseInt(req.query.page_size) || 10, 100);
  const offset = (page - 1) * pageSize;

  const total = db.prepare('SELECT COUNT(*) as count FROM jobs').get().count;
  const jobs = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(pageSize, offset);

  res.json({ jobs, total, page, page_size: pageSize });
});

// Get job
router.get('/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) {
    return res.status(404).json({ detail: 'Job not found' });
  }
  res.json(job);
});

// Start job
router.post('/:id/start', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) {
    return res.status(404).json({ detail: 'Job not found' });
  }

  if (job.status !== 'pending' && job.status !== 'failed') {
    return res.status(400).json({ detail: `Cannot start job with status: ${job.status}` });
  }

  // Start job asynchronously
  jobManager.runJob(req.params.id).catch(console.error);
  res.json(job);
});

// Cancel job
router.post('/:id/cancel', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) {
    return res.status(404).json({ detail: 'Job not found' });
  }

  if (job.status !== 'running') {
    return res.status(400).json({ detail: 'Can only cancel running jobs' });
  }

  jobManager.cancelJob(req.params.id);
  const updatedJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  res.json(updatedJob);
});

// Delete job
router.delete('/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) {
    return res.status(404).json({ detail: 'Job not found' });
  }

  if (job.status === 'running') {
    return res.status(400).json({ detail: 'Cannot delete a running job. Cancel it first.' });
  }

  if (job.input_file_path && fs.existsSync(job.input_file_path)) {
    fs.unlinkSync(job.input_file_path);
  }
  if (job.output_file_path && fs.existsSync(job.output_file_path)) {
    fs.unlinkSync(job.output_file_path);
  }

  db.prepare('DELETE FROM vehicle_results WHERE job_id = ?').run(req.params.id);
  db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);

  res.json({ message: 'Job deleted successfully' });
});

// SSE progress stream
router.get('/:id/progress', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) {
    return res.status(404).json({ detail: 'Job not found' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendProgress = (progress) => {
    res.write(`event: progress\ndata: ${JSON.stringify(progress)}\n\n`);
  };

  const unsubscribe = jobManager.subscribeProgress(req.params.id, sendProgress);

  // Keep-alive interval
  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
});

// Get job results
router.get('/:id/results', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) {
    return res.status(404).json({ detail: 'Job not found' });
  }

  const page = parseInt(req.query.page) || 1;
  const pageSize = Math.min(parseInt(req.query.page_size) || 20, 100);
  const search = req.query.search || '';
  const offset = (page - 1) * pageSize;

  let countQuery = 'SELECT COUNT(*) as count FROM vehicle_results WHERE job_id = ?';
  let resultsQuery = 'SELECT * FROM vehicle_results WHERE job_id = ?';
  const params = [req.params.id];

  if (search) {
    countQuery += ' AND vehicle_number LIKE ?';
    resultsQuery += ' AND vehicle_number LIKE ?';
    params.push(`%${search}%`);
  }

  resultsQuery += ' ORDER BY created_at ASC LIMIT ? OFFSET ?';

  const total = db.prepare(countQuery).get(...params).count;
  const results = db.prepare(resultsQuery).all(...params, pageSize, offset);

  res.json({ results, total, page, page_size: pageSize });
});

// Column definitions for export
const COLUMN_DEFINITIONS = [
  { id: 'vehicle_number', label: 'Vehicle Number', category: 'basic', default: true },
  { id: 'success', label: 'Success', category: 'basic', default: true },
  { id: 'error_message', label: 'Error Message', category: 'basic', default: false },
  { id: 'maker', label: 'Maker', category: 'vehicle', default: true },
  { id: 'maker_model', label: 'Maker Model', category: 'vehicle', default: true },
  { id: 'vehicle_type', label: 'Vehicle Type', category: 'vehicle', default: true },
  { id: 'vehicle_class', label: 'Vehicle Class', category: 'vehicle', default: false },
  { id: 'vehicle_category', label: 'Vehicle Category', category: 'vehicle', default: false },
  { id: 'seating_capacity', label: 'Seating Capacity', category: 'vehicle', default: false },
  { id: 'unladen_weight', label: 'Unladen Weight', category: 'vehicle', default: false },
  { id: 'laden_weight', label: 'Laden Weight', category: 'vehicle', default: false },
  { id: 'sld_status', label: 'SLD Status', category: 'sld', default: true },
  { id: 'speed_governor_number', label: 'Speed Governor Number', category: 'sld', default: false },
  { id: 'speed_governor_manufacturer', label: 'Speed Governor Manufacturer', category: 'sld', default: false },
  { id: 'speed_governor_type', label: 'Speed Governor Type', category: 'sld', default: false },
  { id: 'speed_governor_approval_no', label: 'Speed Governor Approval No', category: 'sld', default: false },
  { id: 'speed_governor_test_report_no', label: 'Speed Governor Test Report No', category: 'sld', default: false },
  { id: 'speed_governor_fitment_cert_no', label: 'Speed Governor Fitment Cert No', category: 'sld', default: false },
  { id: 'permit_status', label: 'Permit Status', category: 'permit', default: true },
  { id: 'permit_type', label: 'Permit Type', category: 'permit', default: false },
  { id: 'permit_category', label: 'Permit Category', category: 'permit', default: false },
  { id: 'service_type', label: 'Service Type', category: 'permit', default: false },
  { id: 'office', label: 'Office', category: 'permit', default: false },
];

// Get available columns for export
router.get('/:id/results/columns', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) {
    return res.status(404).json({ detail: 'Job not found' });
  }

  res.json({ columns: COLUMN_DEFINITIONS });
});

// Download results with selected columns (supports xlsx and csv formats)
router.post('/:id/results/download', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) {
    return res.status(404).json({ detail: 'Job not found' });
  }

  const { columns, format = 'xlsx' } = req.body;
  if (!columns || !Array.isArray(columns) || columns.length === 0) {
    return res.status(400).json({ detail: 'No columns selected' });
  }

  if (!['xlsx', 'csv'].includes(format)) {
    return res.status(400).json({ detail: 'Invalid format. Use "xlsx" or "csv"' });
  }

  // Validate column names
  const validColumnIds = COLUMN_DEFINITIONS.map(c => c.id);
  const invalidColumns = columns.filter(c => !validColumnIds.includes(c));
  if (invalidColumns.length > 0) {
    return res.status(400).json({ detail: `Invalid columns: ${invalidColumns.join(', ')}` });
  }

  // Get all results for this job (works even if job failed - exports whatever was extracted)
  const results = db.prepare('SELECT * FROM vehicle_results WHERE job_id = ? ORDER BY created_at ASC').all(req.params.id);

  if (results.length === 0) {
    return res.status(404).json({ detail: 'No results available for export' });
  }

  // Build data with only selected columns
  const columnDefs = columns.map(id => COLUMN_DEFINITIONS.find(c => c.id === id));
  const headers = columnDefs.map(c => c.label);

  const data = results.map(result => {
    const row = {};
    columnDefs.forEach(col => {
      row[col.label] = result[col.id];
    });
    return row;
  });

  const baseFilename = job.input_file_name.replace(/\.[^/.]+$/, '');

  if (format === 'csv') {
    // Create CSV
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(data, { header: headers });
    const csvContent = XLSX.utils.sheet_to_csv(worksheet);

    const filename = `results_${baseFilename}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } else {
    // Create Excel workbook
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(data, { header: headers });
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Results');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const filename = `results_${baseFilename}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
});

// Download results (all columns)
router.get('/:id/results/download', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) {
    return res.status(404).json({ detail: 'Job not found' });
  }

  if (!job.output_file_path || !fs.existsSync(job.output_file_path)) {
    return res.status(404).json({ detail: 'Results file not available yet' });
  }

  res.download(job.output_file_path, `results_${job.input_file_name}`);
});

export default router;
