import { chromium } from 'playwright';

const HOME_URL = 'https://vahan.parivahan.gov.in/vahan/vahan/home.xhtml';

class BrowserManager {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async launchBrowser() {
    // Check if browser is actually connected, not just if references exist
    if (this.browser?.isConnected() && this.page && !this.page.isClosed()) {
      return this.page;
    }

    // Clean up any stale references
    await this.closeBrowser();

    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote'
      ]
    });
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();

    await this.page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
    return this.page;
  }

  isBrowserOpen() {
    return this.browser?.isConnected() && this.page && !this.page.isClosed();
  }

  async getPage() {
    return this.page;
  }

  async checkAuthStatus() {
    if (!this.page) {
      return false;
    }

    try {
      const currentUrl = this.page.url().toLowerCase();
      if (currentUrl.includes('login')) {
        return false;
      }

      const content = await this.page.content();
      if (content.toLowerCase().includes('logout') || content.toLowerCase().includes('sign out')) {
        return true;
      }

      // Try navigating to home and check if redirected to login
      await this.page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await new Promise(resolve => setTimeout(resolve, 1000));
      const newUrl = this.page.url().toLowerCase();
      return !newUrl.includes('login');
    } catch {
      return false;
    }
  }

  async captureScreenshot() {
    if (!this.page) {
      throw new Error('Browser not open');
    }
    return await this.page.screenshot({ type: 'png' });
  }

  async closeBrowser() {
    try {
      if (this.context) {
        await this.context.close().catch(() => {});
      }
    } finally {
      this.context = null;
    }
    try {
      if (this.browser) {
        await this.browser.close().catch(() => {});
      }
    } finally {
      this.browser = null;
    }
    this.page = null;
  }

  async ensureBrowser() {
    if (!this.isBrowserOpen()) {
      return await this.launchBrowser();
    }
    return this.page;
  }
}

export const browserManager = new BrowserManager();
