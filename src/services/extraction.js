// Extraction service - ports the logic from vahan_bulk_extract_final.py to Node.js
// The original Python file remains unchanged

const TIMEOUT_MS = 35000;
const HOME_URL = 'https://vahan.parivahan.gov.in/vahan/vahan/home.xhtml';
const REPORT_MENU_TEXTS = ['Report', 'REPORT'];
const REGISTERED_VEH_DETAILS_TEXTS = ['Registered Vehicle Details', 'REGISTERED VEHICLE DETAILS'];
const SHOW_DETAILS_TEXTS = ['Show Details', 'SHOW DETAILS'];

const TAB_TARGETS = {
  'Vehicle Details': {
    names: ['Vehicle Details', 'VEHICLE DETAILS', 'Vehicle'],
    checks: [
      "xpath=//legend[contains(normalize-space(.),'Vehicle Information')]",
      "xpath=//label[contains(normalize-space(.),'Maker')]",
    ],
    indexHint: 2,
  },
  'SLD Details': {
    names: ['SLD Details', 'Speed Limiting Device', 'Speed Governor', 'SLD'],
    checks: [
      "xpath=//legend[contains(normalize-space(.),'Speed Governor Details')]",
      "xpath=//label[contains(normalize-space(.),'Speed Governor Number')]",
      "xpath=//th[contains(normalize-space(.),'SLD UIN')]",
    ],
    indexHint: 5,
  },
  'Permit Details': {
    names: ['Permit Details', 'PERMIT DETAILS', 'Permit'],
    checks: [
      "xpath=//label[contains(normalize-space(.),'Permit Category')]",
      "xpath=//label[contains(normalize-space(.),'Permit Type')]",
    ],
    indexHint: 8,
  },
};

const VEHICLE_FIELDS = [
  [['Maker', 'Manufacturer', 'Make'], 'maker'],
  [['Maker Model', 'Model'], 'maker_model'],
  [['Vehicle Type', 'Type'], 'vehicle_type'],
  [['Vehicle Class', 'Class'], 'vehicle_class'],
  [['Vehicle Category', 'Category'], 'vehicle_category'],
  [['Seating Capacity'], 'seating_capacity'],
  [['Unladen Weight (Kg.)', 'Unladen Weight'], 'unladen_weight'],
  [['Laden Weight (Kg.)', 'Laden Weight'], 'laden_weight'],
];

const SLD_FIELDS = [
  [['Speed Governor Number'], 'speed_governor_number'],
  [['Speed Governor Manufacturer Name', 'Manufacturer Name'], 'speed_governor_manufacturer'],
  [['Speed Governor Type', 'SLD TYPE', 'SLD Type', 'Type'], 'speed_governor_type'],
  [['Speed Governor Type Approval No', 'Type Approval No'], 'speed_governor_approval_no'],
  [['Speed Governor Test Report No', 'Test Report No'], 'speed_governor_test_report_no'],
  [['Speed Governor Fitment Cert No', 'Fitment Cert No'], 'speed_governor_fitment_cert_no'],
];

const PERMIT_FIELDS = [
  [['Permit Type'], 'permit_type'],
  [['Permit Category'], 'permit_category'],
  [['Service Type'], 'service_type'],
  [['Office'], 'office'],
];

async function ensurePageReady(page) {
  // Make sure the page is at the home URL and fully loaded
  try {
    const currentUrl = page.url();
    if (!currentUrl.includes('vahan.parivahan.gov.in') || currentUrl.includes('login')) {
      await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(1000);
    }

    // Wait for page to be interactive
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });

    // Wait for main menu to be visible
    for (let i = 0; i < 5; i++) {
      try {
        const reportMenu = page.getByText('Report', { exact: false }).first();
        if (await reportMenu.count() > 0) {
          return true;
        }
      } catch {
        // continue waiting
      }
      await page.waitForTimeout(500);
    }
  } catch {
    // ignore errors, proceed anyway
  }
  return true;
}

async function openRegisteredVehicleDetails(page) {
  // Ensure page is ready first
  await ensurePageReady(page);

  // Wait a moment for any animations/loading
  await page.waitForTimeout(300);

  // Hover REPORT menu with retry
  let hoverSuccess = false;
  for (let attempt = 0; attempt < 3 && !hoverSuccess; attempt++) {
    for (const t of REPORT_MENU_TEXTS) {
      try {
        await page.getByText(t, { exact: false }).first().hover({ timeout: 2000 });
        hoverSuccess = true;
        break;
      } catch {
        try {
          await page.getByRole('link', { name: t }).hover({ timeout: 2000 });
          hoverSuccess = true;
          break;
        } catch {
          // continue
        }
      }
    }
    if (!hoverSuccess) {
      await page.waitForTimeout(500);
    }
  }

  // Wait for dropdown menu to appear after hover
  await page.waitForTimeout(300);

  // Click 'Registered Vehicle Details'
  for (const t of REGISTERED_VEH_DETAILS_TEXTS) {
    try {
      await page.getByRole('link', { name: t }).first().click({ timeout: TIMEOUT_MS });
      return true;
    } catch {
      try {
        await page.getByText(t, { exact: false }).first().click({ timeout: TIMEOUT_MS });
        return true;
      } catch {
        // continue
      }
    }
  }

  try {
    await page.evaluate((txts) => {
      const el = [...document.querySelectorAll('a,button,span,div')]
        .find(n => txts.some(t => (n.textContent || '').trim() === t));
      if (el) { el.click(); return true; }
      return false;
    }, REGISTERED_VEH_DETAILS_TEXTS);
    return true;
  } catch {
    return false;
  }
}

async function ensureSearchFormReady(page) {
  for (let i = 0; i < 10; i++) {
    try {
      const loc = page.locator("xpath=//label[contains(normalize-space(.),'Vehicle Registration No')]/following::input[1]").first();
      await loc.waitFor({ timeout: 1200 });
      await loc.click({ timeout: 600 });
      return;
    } catch {
      try {
        await page.getByRole('textbox').first().click({ timeout: 800 });
        return;
      } catch {
        // continue
      }
    }
    await page.waitForTimeout(250);
  }
  await openRegisteredVehicleDetails(page);
  await page.waitForTimeout(250);
}

function regInput(page) {
  return page.locator("xpath=//label[contains(normalize-space(.),'Vehicle Registration No')]/following::input[1]").first();
}

async function clickShowDetails(page) {
  for (const t of SHOW_DETAILS_TEXTS) {
    try {
      await page.getByRole('button', { name: t }).click({ timeout: 2000 });
      return true;
    } catch {
      try {
        await page.getByText(t, { exact: false }).first().click({ timeout: 2000 });
        return true;
      } catch {
        // continue
      }
    }
  }

  try {
    await page.evaluate((txts) => {
      const el = [...document.querySelectorAll('button,input[type=button],a')]
        .find(n => txts.some(t => (n.textContent || '').trim() === t));
      if (el) { el.click(); return true; }
      return false;
    }, SHOW_DETAILS_TEXTS);
    return true;
  } catch {
    return false;
  }
}

async function waitRegisteredVehiclePage(page) {
  try {
    await page.getByRole('heading', { name: 'Registered Vehicle Details' }).waitFor({ timeout: TIMEOUT_MS });
  } catch {
    await page.locator("h1.header-main:has-text('Registered Vehicle Details')").first().waitFor({ timeout: TIMEOUT_MS });
  }
  await page.locator('.ui-tabs-nav').first().waitFor({ timeout: TIMEOUT_MS });
}

async function tabAvailable(page, tabKey) {
  const cfg = TAB_TARGETS[tabKey];
  try {
    const bar = page.locator('.ui-tabs-nav');
    if (await bar.count() === 0) return false;
    for (const nm of cfg.names) {
      if (await page.getByRole('tab', { name: nm }).count() > 0) return true;
      if (await page.getByRole('link', { name: nm }).count() > 0) return true;
      if (await page.getByText(nm, { exact: false }).count() > 0) return true;
      if (await page.locator(`xpath=//*[contains(@class,'ui-tabs-nav')]//*[self::a or self::span or self::div][normalize-space(text())='${nm}']`).count() > 0) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

async function aggressiveClickTab(page, tabKey, timeoutMs = 9000) {
  const required = tabKey === 'Vehicle Details';

  if (!await tabAvailable(page, tabKey)) {
    if (!required) {
      return false;
    }
  }

  const cfg = TAB_TARGETS[tabKey];

  try {
    await page.evaluate(() => document.querySelector('.ui-tabs-nav')?.scrollIntoView({ block: 'center' }));
  } catch {
    // ignore
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    for (const nm of cfg.names) {
      const getters = [
        () => page.getByRole('tab', { name: nm }).first(),
        () => page.getByRole('link', { name: nm }).first(),
        () => page.getByText(nm, { exact: false }).first(),
        () => page.locator(`xpath=//*[contains(@class,'ui-tabs-nav')]//*[self::a or self::span or self::div][normalize-space(text())='${nm}']`).first(),
      ];

      for (const getter of getters) {
        try {
          const el = getter();
          if (await el.count() === 0) continue;
          await el.scrollIntoViewIfNeeded({ timeout: 1200 });
          await el.click({ timeout: 1500, force: true });

          for (const sel of cfg.checks) {
            try {
              await page.locator(sel).first().waitFor({ timeout: timeoutMs });
              return true;
            } catch {
              continue;
            }
          }
        } catch {
          continue;
        }
      }
    }
  }

  // Fallback: try clicking by index
  if (required) {
    try {
      const items = page.locator('.ui-tabs-nav li a, .ui-tabs-nav li span, .ui-tabs-nav li div');
      const cnt = await items.count();
      if (cnt > 0) {
        const idx = Math.min(cfg.indexHint || 0, cnt - 1);
        for (const i of [idx, Math.min(idx + 1, cnt - 1), Math.max(0, idx - 1)]) {
          try {
            await items.nth(i).click({ timeout: 1200, force: true });
            for (const sel of cfg.checks) {
              try {
                await page.locator(sel).first().waitFor({ timeout: timeoutMs });
                return true;
              } catch {
                continue;
              }
            }
          } catch {
            continue;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return false;
}

async function readValue(elem) {
  try {
    const tag = await elem.evaluate(el => el.tagName.toLowerCase());

    if (tag === 'input' || tag === 'textarea') {
      try {
        return (await elem.inputValue()).trim();
      } catch {
        return (await elem.evaluate(el => el.value || el.textContent || '')).trim();
      }
    }

    if (tag === 'select') {
      return (await elem.evaluate(el => {
        const i = el.selectedIndex;
        return i >= 0 ? (el.options[i].textContent || '').trim() : (el.value || '');
      })).trim();
    }

    // PrimeFaces selectOneMenu
    try {
      const lab = elem.locator('.ui-selectonemenu-label').first();
      if (await lab.count() > 0) {
        const txt = (await lab.textContent() || '').trim();
        if (txt && txt.toUpperCase() !== 'CHOOSE') return txt;
      }
    } catch {
      // ignore
    }

    const nested = elem.locator('input, textarea, select').first();
    if (await nested.count() > 0) return await readValue(nested);

    return (await elem.textContent() || '').trim();
  } catch {
    try {
      return (await elem.textContent() || '').trim();
    } catch {
      return '';
    }
  }
}

async function readLabelSmart(page, labelVariants) {
  // via 'for' attribute
  for (const lbl of labelVariants) {
    try {
      const labelEl = page.locator(`xpath=//label[contains(normalize-space(.),'${lbl}')]`).first();
      await labelEl.waitFor({ timeout: 1000 });
      const forId = await labelEl.getAttribute('for');
      if (forId) {
        const tgt = page.locator(`#${forId}`).first();
        if (await tgt.count() > 0) {
          const val = await readValue(tgt);
          if (val) return val;
        }
        const lab = page.locator(`#${forId} ~ span.ui-selectonemenu-label, span[aria-labelledby='${forId}'].ui-selectonemenu-label`).first();
        if (await lab.count() > 0) {
          const txt = (await lab.textContent() || '').trim();
          if (txt && txt.toUpperCase() !== 'CHOOSE') return txt;
        }
      }
    } catch {
      // continue
    }
  }

  // in the same row/container
  for (const lbl of labelVariants) {
    try {
      const el = page.locator(`xpath=//label[contains(normalize-space(.),'${lbl}')]`).first();
      await el.waitFor({ timeout: 1000 });
      const container = el.locator("xpath=ancestor::tr[1] | ancestor::div[contains(@class,'row') or contains(@class,'ui-grid')][1]").first();
      for (const sel of ['.ui-selectonemenu-label', 'input, select, textarea', 'span.ui-inputfield, span.ui-outputlabel, div.readonly-value, span.readonly-value']) {
        const cand = container.locator(sel).first();
        if (await cand.count() > 0) {
          const val = await readValue(cand);
          if (val) return val;
        }
      }
    } catch {
      // continue
    }
  }

  // naive "next element" fallbacks
  for (const lbl of labelVariants) {
    for (const xp of [
      `xpath=//label[contains(normalize-space(.),'${lbl}')]/following::*[self::span[contains(@class,'ui-selectonemenu-label')] or self::input or self::select or self::textarea][1]`,
      `xpath=//label[contains(normalize-space(.),'${lbl}')]/following::span[1]`,
    ]) {
      try {
        const loc = page.locator(xp).first();
        await loc.waitFor({ timeout: 800 });
        const val = await readValue(loc);
        if (val) return val;
      } catch {
        // continue
      }
    }
  }

  return '';
}

async function readTableHeaderValue(page, headerVariants) {
  for (const hv of headerVariants) {
    try {
      const cell = page.locator(`xpath=//th[contains(normalize-space(.),'${hv}')]/following-sibling::td[1] | //td[contains(@headers,'${hv}')][1]`).first();
      await cell.waitFor({ timeout: 800 });
      const val = (await cell.textContent() || '').trim();
      if (val) return val;
    } catch {
      // continue
    }
  }
  return '';
}

async function attemptExtraction(page, vehicleNumber, log) {
  await openRegisteredVehicleDetails(page);
  await ensureSearchFormReady(page);

  const regEl = regInput(page);
  await regEl.fill('');
  await page.waitForTimeout(100);
  await regEl.fill(vehicleNumber);
  await page.waitForTimeout(200);
  await clickShowDetails(page);
  await waitRegisteredVehiclePage(page);
}

export async function extractVehicleData(page, vehicleNumber, log = console.log, retryCount = 0) {
  const row = {
    vehicle_number: vehicleNumber,
    sld_status: 'Missing',
    permit_status: 'Missing',
    success: false,
    error_message: null,
  };

  const maxRetries = 2;

  try {
    log(`Processing ${vehicleNumber} ...`);

    // Try extraction with retry on failure
    let extractionSuccess = false;
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries && !extractionSuccess; attempt++) {
      try {
        if (attempt > 0) {
          log(`Retry attempt ${attempt} for ${vehicleNumber}...`);
          // Navigate back to home and start fresh on retry
          await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await page.waitForTimeout(1000);
        }
        await attemptExtraction(page, vehicleNumber, log);
        extractionSuccess = true;
      } catch (e) {
        lastError = e;
        if (attempt < maxRetries) {
          log(`Attempt ${attempt + 1} failed for ${vehicleNumber}: ${e.message}, retrying...`);
          await page.waitForTimeout(500);
        }
      }
    }

    if (!extractionSuccess) {
      throw lastError || new Error('Extraction failed after retries');
    }

    // VEHICLE tab (REQUIRED): try twice
    let vehOk = await aggressiveClickTab(page, 'Vehicle Details');
    if (!vehOk) {
      try {
        await page.evaluate(() => window.scrollTo(0, 0));
      } catch {
        // ignore
      }
      vehOk = await aggressiveClickTab(page, 'Vehicle Details');
    }

    if (vehOk) {
      for (const [labels, fieldName] of VEHICLE_FIELDS) {
        const val = await readLabelSmart(page, labels);
        if (val) row[fieldName] = val;
      }
    } else {
      log('WARNING: Vehicle Details could not be opened; leaving vehicle fields blank.');
    }

    // SLD tab (OPTIONAL)
    const sldOk = await aggressiveClickTab(page, 'SLD Details');
    if (sldOk) {
      row.sld_status = 'Present';
      for (const [labels, fieldName] of SLD_FIELDS) {
        let val = await readLabelSmart(page, labels);
        if (fieldName === 'speed_governor_type' && !val) {
          val = await readTableHeaderValue(page, ['SLD TYPE', 'Speed Governor Type', 'Type']);
        }
        if (val) row[fieldName] = val;
      }
    }

    // PERMIT tab (OPTIONAL)
    const permitOk = await aggressiveClickTab(page, 'Permit Details');
    if (permitOk) {
      row.permit_status = 'Present';
      for (const [labels, fieldName] of PERMIT_FIELDS) {
        const val = await readLabelSmart(page, labels);
        if (val) row[fieldName] = val;
      }
    }

    row.success = true;
  } catch (e) {
    row.error_message = e.message;
    row.success = false;
    log(`Error for ${vehicleNumber}: ${e.message}`);
  }

  await page.waitForTimeout(400);
  return row;
}
