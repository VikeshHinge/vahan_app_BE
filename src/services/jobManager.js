import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';
import db from '../db/database.js';
import { browserManager } from './browserManager.js';
import { extractVehicleData } from './extraction.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, '../../results');

class JobManager {
  constructor() {
    this.runningJobs = new Map();
    this.cancelledJobs = new Set();
    this.progressSubscribers = new Map();
  }

  async runJob(jobId) {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!job) return;

    // Check authentication
    const isAuth = await browserManager.checkAuthStatus();
    if (!isAuth) {
      db.prepare(`UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?`)
        .run('waiting_auth', jobId);

      this.emitProgress(jobId, {
        job_id: jobId,
        status: 'waiting_auth',
        processed: 0,
        total: job.total_vehicles,
        successful: 0,
        failed: 0,
        message: 'Waiting for authentication',
      });

      // Launch browser and wait for auth
      await browserManager.launchBrowser();

      const maxWait = 600; // 10 minutes
      let waited = 0;
      while (waited < maxWait) {
        if (this.cancelledJobs.has(jobId)) {
          db.prepare(`UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?`)
            .run('cancelled', jobId);
          return;
        }
        const authOk = await browserManager.checkAuthStatus();
        if (authOk) break;
        await new Promise(resolve => setTimeout(resolve, 2000));
        waited += 2;
      }

      if (!await browserManager.checkAuthStatus()) {
        db.prepare(`UPDATE jobs SET status = ?, error_message = ?, updated_at = datetime('now') WHERE id = ?`)
          .run('failed', 'Authentication timeout', jobId);

        this.emitProgress(jobId, {
          job_id: jobId,
          status: 'failed',
          processed: 0,
          total: job.total_vehicles,
          successful: 0,
          failed: 0,
          message: 'Authentication timeout',
        });
        return;
      }
    }

    // Start extraction
    db.prepare(`UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?`)
      .run('running', jobId);

    this.emitProgress(jobId, {
      job_id: jobId,
      status: 'running',
      processed: 0,
      total: job.total_vehicles,
      successful: 0,
      failed: 0,
      message: 'Starting extraction',
    });

    try {
      await this.runExtraction(jobId);
    } catch (e) {
      db.prepare(`UPDATE jobs SET status = ?, error_message = ?, updated_at = datetime('now') WHERE id = ?`)
        .run('failed', e.message, jobId);

      const updatedJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
      this.emitProgress(jobId, {
        job_id: jobId,
        status: 'failed',
        processed: updatedJob.processed_vehicles,
        total: updatedJob.total_vehicles,
        successful: updatedJob.successful_extractions,
        failed: updatedJob.failed_extractions,
        message: `Error: ${e.message}`,
      });
    }
  }

  async runExtraction(jobId) {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!job) return;

    // Read vehicle numbers from input file
    const workbook = XLSX.read(fs.readFileSync(job.input_file_path));
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);

    const vehicleNumbers = data
      .map(row => row.vehicle_number)
      .filter(v => v)
      .map(v => String(v).toUpperCase().replace(/\s+/g, ''));

    const page = await browserManager.ensureBrowser();
    const allRows = [];
    let processedCount = 0;
    let successCount = 0;
    let failCount = 0;

    const log = (msg) => console.log(`[Job ${jobId}] ${msg}`);

    // Warm-up: Navigate to home page and ensure we're in a good state before starting
    log('Warming up browser session...');
    try {
      await page.goto('https://vahan.parivahan.gov.in/vahan/vahan/home.xhtml', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(1500);
      log('Browser warm-up complete');
    } catch (e) {
      log(`Warm-up warning: ${e.message}`);
    }

    for (const vehicleNumber of vehicleNumbers) {
      if (this.cancelledJobs.has(jobId)) {
        db.prepare(`UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?`)
          .run('cancelled', jobId);

        this.emitProgress(jobId, {
          job_id: jobId,
          status: 'cancelled',
          processed: processedCount,
          total: job.total_vehicles,
          successful: successCount,
          failed: failCount,
          message: 'Job cancelled',
        });
        return;
      }

      this.emitProgress(jobId, {
        job_id: jobId,
        status: 'running',
        current_vehicle: vehicleNumber,
        processed: processedCount,
        total: job.total_vehicles,
        successful: successCount,
        failed: failCount,
        message: `Processing ${vehicleNumber}`,
      });

      // Extract data
      const row = await extractVehicleData(page, vehicleNumber, log);
      allRows.push(row);

      // Save result to database
      const resultId = uuidv4();
      db.prepare(`
        INSERT INTO vehicle_results (
          id, job_id, vehicle_number, success, error_message,
          maker, maker_model, vehicle_type, vehicle_class, vehicle_category,
          seating_capacity, unladen_weight, laden_weight,
          sld_status, speed_governor_number, speed_governor_manufacturer,
          speed_governor_type, speed_governor_approval_no, speed_governor_test_report_no,
          speed_governor_fitment_cert_no,
          permit_status, permit_type, permit_category, service_type, office
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        resultId, jobId, row.vehicle_number, row.success ? 1 : 0, row.error_message,
        row.maker, row.maker_model, row.vehicle_type, row.vehicle_class, row.vehicle_category,
        row.seating_capacity, row.unladen_weight, row.laden_weight,
        row.sld_status, row.speed_governor_number, row.speed_governor_manufacturer,
        row.speed_governor_type, row.speed_governor_approval_no, row.speed_governor_test_report_no,
        row.speed_governor_fitment_cert_no,
        row.permit_status, row.permit_type, row.permit_category, row.service_type, row.office
      );

      processedCount++;
      if (row.success) {
        successCount++;
      } else {
        failCount++;
      }

      // Update job stats
      db.prepare(`
        UPDATE jobs SET
          processed_vehicles = ?,
          successful_extractions = ?,
          failed_extractions = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(processedCount, successCount, failCount, jobId);

      this.emitProgress(jobId, {
        job_id: jobId,
        status: 'running',
        current_vehicle: vehicleNumber,
        processed: processedCount,
        total: job.total_vehicles,
        successful: successCount,
        failed: failCount,
        message: `Completed ${vehicleNumber}`,
      });
    }

    // Save results to Excel
    const outputPath = path.join(RESULTS_DIR, `${jobId}_results.xlsx`);
    const wsData = allRows.map(row => ({
      vehicle_number: row.vehicle_number,
      Maker: row.maker || '',
      'Maker Model': row.maker_model || '',
      'Vehicle Type': row.vehicle_type || '',
      'Vehicle Class': row.vehicle_class || '',
      'Vehicle Category': row.vehicle_category || '',
      'Seating Capacity': row.seating_capacity || '',
      'Unladen Weight (Kg.)': row.unladen_weight || '',
      'Laden Weight (Kg.)': row.laden_weight || '',
      'Speed Governor Number': row.speed_governor_number || '',
      'Speed Governor Manufacturer Name': row.speed_governor_manufacturer || '',
      'Speed Governor Type': row.speed_governor_type || '',
      'Speed Governor Type Approval No': row.speed_governor_approval_no || '',
      'Speed Governor Test Report No': row.speed_governor_test_report_no || '',
      'Speed Governor Fitment Cert No': row.speed_governor_fitment_cert_no || '',
      'Permit Type': row.permit_type || '',
      'Permit Category': row.permit_category || '',
      'Service Type': row.service_type || '',
      'Office': row.office || '',
      'SLD_Status': row.sld_status || '',
      'Permit_Status': row.permit_status || '',
    }));

    const ws = XLSX.utils.json_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Results');
    fs.writeFileSync(outputPath, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

    // Update job as completed
    db.prepare(`
      UPDATE jobs SET
        status = 'completed',
        output_file_path = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(outputPath, jobId);

    this.emitProgress(jobId, {
      job_id: jobId,
      status: 'completed',
      processed: processedCount,
      total: job.total_vehicles,
      successful: successCount,
      failed: failCount,
      message: 'Extraction complete',
    });
  }

  cancelJob(jobId) {
    this.cancelledJobs.add(jobId);
    db.prepare(`UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?`)
      .run('cancelled', jobId);
  }

  subscribeProgress(jobId, callback) {
    if (!this.progressSubscribers.has(jobId)) {
      this.progressSubscribers.set(jobId, new Set());
    }
    this.progressSubscribers.get(jobId).add(callback);

    // Send current state
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (job) {
      callback({
        job_id: jobId,
        status: job.status,
        processed: job.processed_vehicles,
        total: job.total_vehicles,
        successful: job.successful_extractions,
        failed: job.failed_extractions,
        message: `Current status: ${job.status}`,
      });
    }

    return () => {
      const subscribers = this.progressSubscribers.get(jobId);
      if (subscribers) {
        subscribers.delete(callback);
      }
    };
  }

  emitProgress(jobId, progress) {
    const subscribers = this.progressSubscribers.get(jobId);
    if (subscribers) {
      for (const callback of subscribers) {
        callback(progress);
      }
    }
  }
}

export const jobManager = new JobManager();
