import { chromium } from 'playwright';

const HOME_URL = 'https://vahan.parivahan.gov.in/vahan/vahan/home.xhtml';

class BrowserManager {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async launchBrowser() {
    if (this.browser && this.page) {
      return this.page;
    }

    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();

    await this.page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
    return this.page;
  }

  isBrowserOpen() {
    return this.browser !== null && this.page !== null;
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
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    this.page = null;
  }

  async ensureBrowser() {
    if (!this.page) {
      return await this.launchBrowser();
    }
    return this.page;
  }
}

export const browserManager = new BrowserManager();
