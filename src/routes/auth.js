import { Router } from 'express';
import { browserManager } from '../services/browserManager.js';

const router = Router();

// Get auth status
router.get('/status', async (req, res) => {
  const authenticated = await browserManager.checkAuthStatus();
  const browserOpen = browserManager.isBrowserOpen();

  let message;
  if (authenticated) {
    message = 'Authenticated and ready';
  } else if (browserOpen) {
    message = 'Browser open - waiting for login';
  } else {
    message = 'Not authenticated - browser not started';
  }

  res.json({ authenticated, browser_open: browserOpen, message });
});

// Init browser
router.post('/init-browser', async (req, res) => {
  try {
    await browserManager.launchBrowser();
    res.json({ success: true, message: 'Browser launched. Please log in to Vahan portal.' });
  } catch (e) {
    res.status(500).json({ detail: `Failed to launch browser: ${e.message}` });
  }
});

// Get screenshot
router.get('/screenshot', async (req, res) => {
  if (!browserManager.isBrowserOpen()) {
    return res.status(400).json({ detail: 'Browser is not open' });
  }

  try {
    const screenshot = await browserManager.captureScreenshot();
    const screenshotB64 = screenshot.toString('base64');
    res.json({ screenshot: screenshotB64 });
  } catch (e) {
    res.status(500).json({ detail: `Failed to capture screenshot: ${e.message}` });
  }
});

// Confirm login
router.post('/confirm-login', async (req, res) => {
  const authenticated = await browserManager.checkAuthStatus();
  if (authenticated) {
    res.json({ success: true, message: 'Login confirmed' });
  } else {
    res.status(400).json({ detail: 'Login not complete. Please ensure you are logged in to Vahan portal.' });
  }
});

// Close browser
router.post('/close-browser', async (req, res) => {
  await browserManager.closeBrowser();
  res.json({ success: true, message: 'Browser closed' });
});

export default router;
