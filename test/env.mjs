/* Portable test environment: real schedules can be supplied explicitly, but
   public CI falls back to sanitized generated workbooks. Chromium likewise
   uses an explicit override, the old Linux image path, or Playwright's own
   installed browser in that order. */

import fs from 'fs';
import path from 'path';
import { ensureWorkbookFixtures } from './workbook-fixture.mjs';

export const ROOT = path.resolve(import.meta.dirname, '..');

export function workbookPaths() {
  const explicit = {
    rolling: process.env.BV_ROLLING_WORKBOOK,
    cnc: process.env.BV_CNC_WORKBOOK,
    daily: process.env.BV_DAILY_WORKBOOK,
  };
  if (explicit.rolling && explicit.cnc
      && fs.existsSync(explicit.rolling) && fs.existsSync(explicit.cnc)) {
    const fixture = ensureWorkbookFixtures();
    return {
      ...explicit,
      daily: explicit.daily && fs.existsSync(explicit.daily) ? explicit.daily : fixture.daily,
      material: fixture.material,
      crew: fixture.crew,
      synthetic: false,
    };
  }

  const old = '/root/.claude/uploads/042835a0-704b-5601-bc20-4ed82d27578f';
  const legacy = {
    rolling: `${old}/da7bb9f1-Rolling_Schedule_2026.xlsx`,
    cnc: `${old}/bae855fd-CNC_Schedule_Rev_E.xlsx`,
  };
  if (fs.existsSync(legacy.rolling) && fs.existsSync(legacy.cnc)) {
    const fixture = ensureWorkbookFixtures();
    return { ...legacy, daily: fixture.daily, material: fixture.material, crew: fixture.crew, synthetic: false };
  }
  return ensureWorkbookFixtures();
}

/** Pin the shop calendar so August fixture dates stay in open groups.
    10:00 on 14 Aug 2026 is a Day shift, and the synthetic workbooks are dated
    that week. Only `Date` moves; timers and animation frames stay real.
    Pass a Playwright page or browser context. */
export async function installShopClock(pageOrContext, when = new Date(2026, 7, 14, 10, 0, 0)) {
  await pageOrContext.addInitScript((epoch) => {
    const RealDate = Date;
    const offset = epoch - RealDate.now();
    function ShopDate(...args) {
      const date = args.length ? new RealDate(...args) : new RealDate(RealDate.now() + offset);
      if (!new.target) return date.toString();
      return date;
    }
    ShopDate.prototype = RealDate.prototype;
    Object.setPrototypeOf(ShopDate, RealDate);
    ShopDate.now = () => RealDate.now() + offset;
    ShopDate.parse = RealDate.parse;
    ShopDate.UTC = RealDate.UTC;
    window.Date = ShopDate;
  }, when.getTime());
}

export function chromiumOptions() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_PATH,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  const executablePath = candidates.find((p) => fs.existsSync(p));
  return executablePath ? { executablePath } : {};
}
