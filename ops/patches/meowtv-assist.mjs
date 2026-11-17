/**
 * MeowTV stream assist — keeps Chromium warm and decrypts api.meowtv.ru payloads.
 * GET /movie/:tmdbId?server=acme
 * GET /tv/:tmdbId/:season/:episode?server=acme
 * GET /health
 */
import http from 'node:http';
import puppeteer from 'puppeteer-core';

const PORT = Number(process.env.MEOWTV_ASSIST_PORT || 3026);
const CHROME =
  process.env.MEOWTV_CHROME || '/opt/meowtv-chrome/chrome';
const UA =
  process.env.MEOWTV_UA ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const SERVERS = (process.env.MEOWTV_SERVERS || 'acme,dcloud,english,hindi,tik')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);


function pickScoreSrcFromHtml(html) {
  const m = String(html || '').match(/\/assets\/s-core-[A-Za-z0-9_-]+\.js/);
  return m ? m[0] : '/assets/s-core-CLWaWtzg.js';
}

let cachedScoreSrc = '';

let browser;
let page;
let bootPromise;
const IDLE_MS = Math.max(60_000, Number(process.env.MEOWTV_IDLE_MS || 3 * 60_000));
let lastUsedAt = 0;
let idleTimer = null;

function touchIdle() {
  lastUsedAt = Date.now();
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (Date.now() - lastUsedAt < IDLE_MS - 1000) return;
    const b = browser;
    browser = null;
    page = null;
    bootPromise = null;
    if (b) {
      console.log('[meowtv-assist] idle — closing Chromium');
      b.close().catch(() => {});
    }
  }, IDLE_MS);
  idleTimer?.unref?.();
}

let bootMutex = Promise.resolve();
async function ensurePage() {
  const prev = bootMutex;
  let release;
  bootMutex = new Promise((r) => { release = r; });
  await prev;
  try {
    return await ensurePageUnlocked();
  } finally {
    release();
  }
}

async function ensurePageUnlocked() {
  try {
    if (page && !page.isClosed()) {
      // Detached frame after Chromium kill/restart — force a fresh page.
      await page.evaluate(() => true);
      return page;
    }
  } catch {
    try { await page?.close(); } catch {}
    page = null;
    try { await browser?.close(); } catch {}
    browser = null;
    bootPromise = null;
  }
  if (!bootPromise) {
    bootPromise = (async () => {
      browser = await puppeteer.launch({
        executablePath: CHROME,
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-gpu',
          `--user-agent=${UA}`,
        ],
      });
      page = await browser.newPage();
      await page.setUserAgent(UA);
      await page.setViewport({ width: 1280, height: 800 });
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        });
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4],
        });
      });
      await page.goto('https://meowtv.ru/', {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      // Warm decrypt module
      {
        const html = await page.content();
        cachedScoreSrc = pickScoreSrcFromHtml(html);
        const scoreSrc = cachedScoreSrc;
        console.log('[meowtv-assist] s-core', scoreSrc);
        await page.evaluate(async (SCORE_SRC) => {
          await import(SCORE_SRC);
        }, scoreSrc);
      }
      return page;
    })().finally(() => {
      bootPromise = null;
    });
  }
  return bootPromise;
}

async function forceRelaunch() {
  try { await page?.close(); } catch {}
  page = null;
  try { await browser?.close(); } catch {}
  browser = null;
  bootPromise = null;
}

function isDetachedError(e) {
  const msg = e instanceof Error ? e.message : String(e);
  return /detached Frame|Target closed|Session closed|Protocol error/i.test(msg);
}

async function resolveOne(kind, tmdbId, season, episode, server) {
  if (!cachedScoreSrc) {
    const p0 = await ensurePage();
    cachedScoreSrc = pickScoreSrcFromHtml(await p0.content());
  }
  touchIdle();
  const run = async () => {
    const p = await ensurePage();
    return p.evaluate(
      async ({ kind, tmdbId, season, episode, server, scoreSrc }) => {
        const mod = await import(scoreSrc);
        const tr = await fetch('https://api.meowtv.ru/streams/ticket', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        const tj = await tr.json();
        if (!tj?.ticket) throw new Error('ticket failed');
        const path =
          kind === 'tv'
            ? `/streams/tv/${tmdbId}/${season}/${episode}?s=${encodeURIComponent(server)}`
            : `/streams/movie/${tmdbId}?s=${encodeURIComponent(server)}`;
        const r = await fetch(`https://api.meowtv.ru${path}`, {
          headers: { 'x-stream-ticket': tj.ticket },
        });
        const raw = await r.json();
        if (!r.ok) throw new Error(raw?.error || `HTTP ${r.status}`);
        const plain = await mod.w(raw);
        if (!plain?.url || /decoy\.invalid/i.test(plain.url)) {
          throw new Error('decoy or empty');
        }
        return {
          url: plain.url,
          language: plain.language || server,
          headers: plain.headers || {},
          server,
        };
      },
      { kind, tmdbId, season, episode, server, scoreSrc: cachedScoreSrc || '/assets/s-core-CLWaWtzg.js' }
    );
  };
  try {
    return await run();
  } catch (e) {
    if (!isDetachedError(e)) throw e;
    await forceRelaunch();
    return await run();
  }
}

async function resolveAll(kind, tmdbId, season, episode) {
  const sources = [];
  const errors = [];
  for (const server of SERVERS) {
    try {
      const hit = await resolveOne(kind, tmdbId, season, episode, server);
      sources.push(hit);
      // First good playlist is enough for fast start
      break;
    } catch (e) {
      errors.push(`${server}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { sources, errors };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  res.setHeader('content-type', 'application/json');
  try {
    if (url.pathname === '/health') {
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    let m = url.pathname.match(/^\/movie\/(\d+)$/);
    if (m) {
      const prefer = url.searchParams.get('server');
      const servers = prefer ? [prefer, ...SERVERS.filter((s) => s !== prefer)] : SERVERS;
      const sources = [];
      const errors = [];
      for (const serverName of servers) {
        try {
          sources.push(
            await resolveOne('movie', m[1], null, null, serverName)
          );
          break;
        } catch (e) {
          errors.push(`${serverName}: ${e instanceof Error ? e.message : e}`);
        }
      }
      res.end(JSON.stringify({ sources, errors }));
      return;
    }
    m = url.pathname.match(/^\/tv\/(\d+)\/(\d+)\/(\d+)$/);
    if (m) {
      const sources = [];
      const errors = [];
      for (const serverName of SERVERS) {
        try {
          sources.push(
            await resolveOne('tv', m[1], m[2], m[3], serverName)
          );
          break;
        } catch (e) {
          errors.push(`${serverName}: ${e instanceof Error ? e.message : e}`);
        }
      }
      res.end(JSON.stringify({ sources, errors }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[meowtv-assist] listening on 127.0.0.1:${PORT} (lazy Chromium)`);
});

process.on('SIGTERM', async () => {
  try {
    await browser?.close();
  } catch {}
  process.exit(0);
});
