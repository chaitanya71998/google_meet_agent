import fs from "fs"
import os from "os"
import path from "path"
import puppeteer, { Browser, Page } from "puppeteer"
import { logger } from "./logger.js"

interface JoinOptions {
  mute?: boolean
  video?: boolean
  /** Display name for anonymous / guest joins */
  name?: string
}

const PROFILE_DIR = path.join(
  os.homedir(),
  ".google_meet_agent",
  "chrome-profile",
)
const PREJOIN_TIMEOUT_MS = 45_000
const MEDIA_PROMPT_TIMEOUT_MS = 5_000

const SELECTORS = {
  nameInput: 'input[aria-label="Your name"]',
  mediaPromptAccept: 'button[aria-label="Use microphone and camera"]',
  mediaPromptContinueWithout:
    'button[aria-label="Continue without microphone and camera"]',
  askToJoin: 'button[aria-label="Ask to join"]',
  joinNow: 'button[aria-label="Join now"]',
  micOff:
    'button[aria-label*="Turn off microphone"], div[role="button"][aria-label*="Turn off microphone"]',
  micOn:
    'button[aria-label*="Turn on microphone"], div[role="button"][aria-label*="Turn on microphone"]',
  camOff:
    'button[aria-label*="Turn off camera"], div[role="button"][aria-label*="Turn off camera"]',
  camOn:
    'button[aria-label*="Turn on camera"], div[role="button"][aria-label*="Turn on camera"]',
  mutedAttr: "[data-is-muted]",
  cookieAccept: 'button[jsname="LgbsSe"]',
} as const

let sharedBrowser: Browser | null = null

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function clickIfPresent(
  page: Page,
  selector: string,
  timeout = 2000,
): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { visible: true, timeout })
    await page.click(selector)
    return true
  } catch {
    return false
  }
}

async function readDevtoolsEndpoint(): Promise<string | null> {
  try {
    const raw = fs
      .readFileSync(path.join(PROFILE_DIR, "DevToolsActivePort"), "utf8")
      .trim()
    const [port] = raw.split("\n")
    if (!port) return null
    return `http://127.0.0.1:${port}`
  } catch {
    return null
  }
}

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser) {
    try {
      await sharedBrowser.version()
      return sharedBrowser
    } catch {
      sharedBrowser = null
    }
  }

  fs.mkdirSync(PROFILE_DIR, { recursive: true })

  // Reattach if a previous Meet session is still open on this profile
  const endpoint = await readDevtoolsEndpoint()
  if (endpoint) {
    try {
      sharedBrowser = await puppeteer.connect({
        browserURL: endpoint,
        defaultViewport: null,
      })
      sharedBrowser.on("disconnected", () => {
        sharedBrowser = null
      })
      return sharedBrowser
    } catch {
      /* fall through to a fresh launch */
    }
  }

  for (const f of [
    "SingletonLock",
    "SingletonSocket",
    "SingletonCookie",
    "RunningChromeVersion",
  ]) {
    try {
      fs.unlinkSync(path.join(PROFILE_DIR, f))
    } catch {
      /* ignore */
    }
  }

  sharedBrowser = await puppeteer.launch({
    headless: false,
    userDataDir: PROFILE_DIR,
    defaultViewport: null,
    args: [
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  })

  sharedBrowser.on("disconnected", () => {
    sharedBrowser = null
  })

  // Grant microphone/camera so SpeechRecognition and Meet get audio input
  try {
    const ctx = sharedBrowser.defaultBrowserContext();
    await ctx.overridePermissions('https://meet.google.com', ['microphone', 'camera']);
  } catch (e) {
    logger.warn('Could not override media permissions', { error: (e as Error).message });
  }

  return sharedBrowser
}

/** Dismiss cookie banners and Meet's own media-permission modal (blocks prejoin). */
async function dismissOverlays(page: Page): Promise<void> {
  await clickIfPresent(page, SELECTORS.cookieAccept, 3000)

  const accepted = await clickIfPresent(
    page,
    SELECTORS.mediaPromptAccept,
    MEDIA_PROMPT_TIMEOUT_MS,
  )
  if (!accepted) {
    await clickIfPresent(page, SELECTORS.mediaPromptContinueWithout, 1500)
  }
}

async function isInCall(page: Page): Promise<boolean> {
  return Boolean(await page.$('button[aria-label="Leave call"]'))
}

/** Poll until in-call UI or prejoin controls appear. */
async function waitForMeetSurface(page: Page): Promise<"incall" | "prejoin"> {
  const deadline = Date.now() + PREJOIN_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await isInCall(page)) return "incall"
    const ready = await page.evaluate(`(() => {
      if (document.querySelector('input[aria-label="Your name"]')) return true;
      if (document.querySelector('button[aria-label="Join now"]')) return true;
      if (document.querySelector('button[aria-label="Ask to join"]')) return true;
      if (document.querySelector('[data-is-muted]')) return true;
      return false;
    })()`)
    if (ready) {
      // Give Leave call a moment — session resume can flash mic controls first
      await sleep(1500)
      if (await isInCall(page)) return "incall"
      return "prejoin"
    }
    await sleep(400)
  }
  throw new Error(
    "Meet UI never appeared (Leave call / name input / Join now / Ask to join). " +
      "You may need to sign in once in the Chrome profile under ~/.google_meet_agent/chrome-profile",
  )
}

async function fillGuestName(page: Page, name: string): Promise<void> {
  const input = await page.$(SELECTORS.nameInput)
  if (!input) return
  await input.click({ clickCount: 3 })
  await page.keyboard.press("Backspace")
  await input.type(name, { delay: 30 })
  // Meet enables Ask to join only after a non-empty name
  await page.evaluate(() => {
    const el = document.querySelector(
      'input[aria-label="Your name"]',
    ) as HTMLInputElement | null
    if (!el) return
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await sleep(800)
}

async function setMic(page: Page, wantMuted: boolean): Promise<void> {
  const attrBtn = await page.$(
    'div[role="button"][data-is-muted], button[data-is-muted]',
  )
  if (attrBtn) {
    const isMuted = await page.evaluate(
      (el) => el.getAttribute("data-is-muted") === "true",
      attrBtn,
    )
    if (wantMuted !== isMuted) await attrBtn.click()
    return
  }

  if (wantMuted) {
    if (await clickIfPresent(page, SELECTORS.micOff, 1500)) return
  } else if (await clickIfPresent(page, SELECTORS.micOn, 1500)) {
    return
  }

  const mod = process.platform === "darwin" ? "Meta" : "Control"
  await page.keyboard.down(mod)
  await page.keyboard.press("KeyD")
  await page.keyboard.up(mod)
}

async function setCamera(page: Page, wantVideoOn: boolean): Promise<void> {
  const videoBtn = await page.$(
    'div[role="button"][data-is-video-muted], button[data-is-video-muted]',
  )
  if (videoBtn) {
    const isOff = await page.evaluate(
      (el) => el.getAttribute("data-is-video-muted") === "true",
      videoBtn,
    )
    if (wantVideoOn === isOff) await videoBtn.click()
    return
  }

  if (wantVideoOn) {
    if (await clickIfPresent(page, SELECTORS.camOn, 1500)) return
  } else if (await clickIfPresent(page, SELECTORS.camOff, 1500)) {
    return
  }

  const mod = process.platform === "darwin" ? "Meta" : "Control"
  await page.keyboard.down(mod)
  await page.keyboard.press("KeyE")
  await page.keyboard.up(mod)
}

/** Find an enabled join-related button by aria-label or visible text. */
async function findJoinButton(page: Page): Promise<boolean> {
  // String form avoids tsx/esbuild injecting `__name` into the browser context
  return page.evaluate(`(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const prefer = ['ask to join', 'join now', 'join meeting'];
    for (const phrase of prefer) {
      for (const b of buttons) {
        const t = ((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')).toLowerCase();
        if (!t.includes(phrase)) continue;
        if (b.disabled || b.getAttribute('aria-disabled') === 'true') continue;
        const style = window.getComputedStyle(b);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        b.click();
        return true;
      }
    }
    return false;
  })()`) as Promise<boolean>
}

async function clickJoin(page: Page): Promise<void> {
  // Wait until Meet enables a join button (often after name is entered),
  // or until we're already admitted (Leave call).
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (await isInCall(page)) return
    if (await clickIfPresent(page, SELECTORS.joinNow, 500)) return
    if (await clickIfPresent(page, SELECTORS.askToJoin, 500)) return
    if (await findJoinButton(page)) return
    await sleep(500)
  }

  if (await isInCall(page)) return

  const snapshot = await page.evaluate(`(() => {
    const buttons = Array.from(document.querySelectorAll('button')).map((b) => ({
      text: (b.textContent || '').trim().slice(0, 80),
      aria: b.getAttribute('aria-label'),
      disabled: b.disabled || b.getAttribute('aria-disabled') === 'true',
    }));
    return { title: document.title, url: location.href, buttons: buttons.slice(0, 25) };
  })()`)

  throw new Error(
    `Could not find Join now / Ask to join button. page=${JSON.stringify(snapshot)}`,
  )
}

/**
 * Launches/reuses Chromium (persistent profile), opens the Meet URL, configures
 * mic/camera, and joins (or asks to join) the meeting.
 */
export async function joinMeet(
  meetUrl: string,
  opts: JoinOptions = {},
  sessionId?: string,
): Promise<Page> {
  const { mute = true, video = false, name = "Meet Agent" } = opts

  logger.info('joinMeet start', { sessionId, url: meetUrl });
  const browser = await getBrowser()
  const pages = await browser.pages()
  const meetPage = pages.find((p) => p.url().includes("meet.google.com"))
  const page: Page =
    meetPage ||
    (pages[0] && pages[0].url() === "about:blank"
      ? pages[0]
      : await browser.newPage())
  page.setDefaultTimeout(PREJOIN_TIMEOUT_MS)

  if (await isInCall(page)) {
    logger.info("Already in the meeting — skipping prejoin")
    return page
  }

  await page.goto(meetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await sleep(1000)
  await dismissOverlays(page)

  const surface = await waitForMeetSurface(page)
  if (surface === "incall") {
    logger.info("Already in the meeting — skipping prejoin")
    return page
  }

  await dismissOverlays(page)

  await fillGuestName(page, name)

  try {
    await setMic(page, mute)
  } catch (e) {
    console.warn("Mic toggle skipped:", (e as Error).message)
  }
  try {
    await setCamera(page, video)
  } catch (e) {
    console.warn("Camera toggle skipped:", (e as Error).message)
  }

  await clickJoin(page)
  await sleep(5000)
  return page
}
