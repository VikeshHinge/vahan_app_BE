import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import jobsRouter from './routes/jobs.js';
import authRouter from './routes/auth.js';
import { browserManager } from './services/browserManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '../uploads');

// Ensure uploads folder exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());

// File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`),
});
const upload = multer({ storage });

// Routes
app.use('/api/jobs', upload.single('file'), jobsRouter);
app.use('/api/auth', authRouter);

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'Vahan Vehicle Extractor API', status: 'running' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await browserManager.closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down...');
  await browserManager.closeBrowser();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
