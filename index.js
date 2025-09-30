const fetch = globalThis.fetch;
import fs from "fs";
import readlineSync from "readline-sync";
import notifier from "node-notifier";
import path from "path";
import { parse } from "jsonc-parser";
import { execFile } from "child_process";

const API = "https://api.vrchat.cloud/api/1";

// Bump this value when releasing a new app version
const APP_VERSION = "1.0.0";

const isPkg =
  typeof process !== "undefined" && typeof process.pkg !== "undefined";
const exeDir = isPkg ? path.dirname(process.execPath) : process.cwd();
const writeableDir = exeDir; // write session/debug/blockedGroups next to exe when packaged
const debugLogFile = path.resolve(path.join(writeableDir, "debug.log"));

// checkAppVersion(): Compare local APP_VERSION to the version embedded in blockedGroups.jsonc
// If different, notify the user (console, Windows toast, Discord webhook if configured).
async function checkAppVersion(remoteVersion) {
  try {
    if (!remoteVersion || typeof remoteVersion !== "string") return;
    if (remoteVersion === APP_VERSION) {
      logDebug("App version is up to date:", APP_VERSION);
      return;
    }
    const msg = `New app version available: ${remoteVersion} (installed: ${APP_VERSION}). Please download the latest release from the repository.`;
    console.log(`⚠️ UPDATE AVAILABLE: ${msg}`);
    try {
      windowsNotify(msg);
    } catch (e) {
      logDebug("windowsNotify for update failed:", e && (e.message || e));
    }
    try {
      await discordNotify(msg);
    } catch (e) {
      logDebug("discordNotify for update failed:", e && (e.message || e));
    }
  } catch (e) {
    logDebug("checkAppVersion unexpected error:", e && (e.message || e));
  }
}

function readBundledOrExternal(filename, fallbackContent = null) {
  const candidates = [
    path.join(process.cwd(), filename),
    path.join(writeableDir, filename),
    // __dirname may only exist for bundled/cjs builds; guard its use
    typeof __dirname !== "undefined" ? path.join(__dirname, filename) : null,
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
    } catch (e) {}
  }
  if (fallbackContent !== null) return fallbackContent;
  throw new Error(`Unable to find ${filename}`);
}

let config = {};
try {
  const configText = readBundledOrExternal(
    "config.json",
    JSON.stringify({
      discordWebhook: null,
      debug: false,
      blockedGroupsAutoUpdate: true,
      blockedGroupsRemoteUrl:
        "https://raw.githubusercontent.com/RWolfyo/VRChatMonitor/refs/heads/master/blockedGroups.jsonc",
      playSound: true,
      playVolume: 0.5,
    })
  );
  config = JSON.parse(configText);
} catch (e) {
  console.error(
    "Failed to load config.json, using defaults:",
    e && (e.message || e)
  );
  config = {
    discordWebhook: null,
    debug: false,
    blockedGroupsAutoUpdate: true,
    blockedGroupsRemoteUrl:
      "https://raw.githubusercontent.com/RWolfyo/VRChatMonitor/refs/heads/master/blockedGroups.jsonc",
    playSound: true,
    playVolume: 0.5,
  };
}

const {
  discordWebhook,
  debug,
  blockedGroupsAutoUpdate = true,
  blockedGroupsRemoteUrl = "https://raw.githubusercontent.com/RWolfyo/VRChatMonitor/refs/heads/master/blockedGroups.jsonc",
  playSound = true,
  playVolume = 0.5,
} = config;

let keywordBlacklist = [];
let keywordRegexes = [];
let whitelistGroupIds = [];
let whitelistUserIds = [];
let blockedGroups = [];

let authHeaders = {};
let cookies = "";
const sessionFile = path.join(writeableDir, "session.json");
const blockedGroupsPath = path.join(writeableDir, "blockedGroups.jsonc");
const recentlySeenJoins = new Set();

// logDebug(): Log debug messages when debug is enabled.
function logDebug(...args) {
  if (!debug) return;
  const msg = args
    .map((a) => (typeof a === "object" ? JSON.stringify(a, null, 2) : a))
    .join(" ");
  console.log("[DEBUG]", msg);
  fs.appendFileSync(debugLogFile, `[${new Date().toISOString()}] ${msg}\n`);
}

// parseCookies(): Parse Set-Cookie headers into a Cookie string.
function parseCookies(setCookieHeaders) {
  if (!setCookieHeaders) return "";
  if (typeof setCookieHeaders === "string")
    return setCookieHeaders.split(";")[0];
  return setCookieHeaders.map((c) => c.split(";")[0]).join("; ");
}

// extractSetCookie(): Robustly extract "set-cookie" values from a fetch Response.
function extractSetCookie(res) {
  try {
    if (!res || !res.headers) return null;
    const h = res.headers;
    if (typeof h.raw === "function") {
      // node-fetch style: raw() -> { 'set-cookie': [ ... ] }
      const raw = h.raw();
      return raw && raw["set-cookie"] ? raw["set-cookie"] : null;
    }
    if (typeof h.get === "function") {
      // WHATWG Headers: get may return a string (possibly combined)
      const val = h.get("set-cookie");
      return val || null;
    }
  } catch (e) {
    logDebug("extractSetCookie failed:", e && (e.message || e));
  }
  return null;
}

// login(): Perform login to VRChat and persist session cookies (prompts for credentials/2FA).
async function login() {
  if (fs.existsSync(sessionFile)) {
    try {
      const session = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
      const sessionCookies =
        session && typeof session.cookies === "string"
          ? session.cookies.trim()
          : "";
      if (sessionCookies) {
        cookies = sessionCookies;
        authHeaders = {
          "User-Agent": "VRChatMonitor/1.0 (hubert@wolfyo.eu)",
          Cookie: cookies,
        };
        try {
          const res = await fetch(`${API}/auth/user`, { headers: authHeaders });
          const data = await res.json();
          logDebug("Reusing session:", data);
          if (res.ok && data.id) {
            console.log(`✅ Logged in as: ${data.displayName} (session reuse)`);
            return data;
          }
        } catch {}
        console.log("⚠️ Cached session invalid, re-login required.");
      } else {
        logDebug(
          "Cached session found but cookies are empty; ignoring cached session."
        );
        // Remove the empty session file to avoid repeated invalid reuse attempts
        try {
          fs.unlinkSync(sessionFile);
          logDebug("Empty session file removed:", sessionFile);
        } catch (e) {}
      }
    } catch (e) {
      logDebug("Failed to read/parse session file:", e && (e.message || e));
      console.log("⚠️ Cached session invalid, re-login required.");
    }
  }

  const username = readlineSync.question("VRChat Username: ");
  const password = readlineSync.question("VRChat Password: ", {
    hideEchoBack: true,
  });
  const auth = Buffer.from(`${username}:${password}`).toString("base64");
  authHeaders = {
    Authorization: `Basic ${auth}`,
    "User-Agent": "VRChatMonitor/1.0 (hubert@wolfyo.eu)",
  };

  let res = await fetch(`${API}/auth/user`, { headers: authHeaders });
  let data = await res.json();
  logDebug("Login step 1 response:", data);

  if (data.requiresTwoFactorAuth) {
    const method = data.requiresTwoFactorAuth.includes("totp") ? "totp" : "otp";
    const code = readlineSync.question(
      `Enter your ${method.toUpperCase()} 2FA code: `
    );

    res = await fetch(`${API}/auth/twofactorauth/${method}/verify`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    data = await res.json();
    logDebug("Login step 2 response:", data);
    if (!res.ok)
      throw new Error(`2FA verification failed: ${JSON.stringify(data)}`);
    console.log("✅ 2FA verified.");

    const setCookie = extractSetCookie(res);
    cookies = parseCookies(setCookie);
    authHeaders = {
      "User-Agent": "VRChatMonitor/1.0 (hubert@wolfyo.eu)",
      Cookie: cookies,
    };
  } else {
    // No 2FA required — try to capture cookies from the initial auth response (if any)
    try {
      const setCookie = extractSetCookie(res);
      const extracted = parseCookies(setCookie);
      if (extracted) {
        cookies = extracted;
        authHeaders = {
          "User-Agent": "VRChatMonitor/1.0 (hubert@wolfyo.eu)",
          Cookie: cookies,
        };
      }
    } catch (e) {
      logDebug(
        "Failed to extract cookies from initial auth response:",
        e && (e.message || e)
      );
    }
  }

  // Verify final login success before saving session file
  res = await fetch(`${API}/auth/user`, { headers: authHeaders });
  data = await res.json();
  logDebug("Final login user data:", data);

  if (!res.ok || !data.id) throw new Error("Login failed after 2FA.");

  // Only persist session.json when we actually captured non-empty cookies
  if (cookies && typeof cookies === "string" && cookies.trim()) {
    try {
      fs.writeFileSync(sessionFile, JSON.stringify({ cookies }, null, 2));
      console.log("💾 Session saved.");
    } catch (e) {
      logDebug("Failed to save session file:", e && (e.message || e));
    }
  } else {
    logDebug(
      "Login succeeded but no cookies were captured; session not saved."
    );
  }

  console.log(`✅ Logged in as: ${data.displayName}`);
  return data;
}

// getCurrentUser(): Get the current authenticated VRChat user.
async function getCurrentUser() {
  const res = await fetch(`${API}/auth/user`, { headers: authHeaders });
  const data = await res.json();
  logDebug("getCurrentUser:", data);
  return data;
}

// getUserGroups(): Fetch groups a user belongs to.
async function getUserGroups(userId) {
  if (!userId || typeof userId !== "string")
    throw new TypeError("getUserGroups: userId must be a string");
  const url = `${API}/users/${userId}/groups`;
  logDebug("Fetching user groups:", url);
  const res = await fetch(url, { headers: authHeaders });
  const data = await res.json();
  logDebug(`Groups for ${userId}:`, data);
  return res.ok ? data : [];
}

// getUser(): Fetch user profile (displayName, bio, etc.)
async function getUser(userId) {
  if (!userId || typeof userId !== "string")
    throw new TypeError("getUser: userId must be a string");
  const url = `${API}/users/${userId}`;
  logDebug("Fetching user profile:", url);
  try {
    const res = await fetch(url, { headers: authHeaders });
    const data = await res.json();
    logDebug(`User profile for ${userId}:`, data);
    return res.ok ? data : null;
  } catch (e) {
    logDebug("getUser failed:", e && (e.stack || e.message || e));
    return null;
  }
}

// parseUserInfoFromLog(): Parse "Name (usr_xxx)" style fragments and return displayName/userId.
function parseUserInfoFromLog(text) {
  if (!text || typeof text !== "string")
    return { displayName: null, userId: null };
  const pos = text.lastIndexOf(" (");
  if (pos >= 0 && text.endsWith(")")) {
    const displayName = text.substring(0, pos);
    const userId = text.substring(pos + 2, text.length - 1);
    return { displayName: displayName || null, userId: userId || null };
  }
  return { displayName: text || null, userId: null };
}

// detectGameLogDir(): Detect VRChat output_log directory for the current platform.
function detectGameLogDir() {
  const candidates = [];
  if (process.platform === "win32") {
    if (process.env.USERPROFILE) {
      candidates.push(
        path.join(
          process.env.USERPROFILE,
          "AppData",
          "LocalLow",
          "VRChat",
          "VRChat"
        )
      );
    }
  } else {
    if (process.env.HOME) {
      candidates.push(
        path.join(process.env.HOME, ".config", "unity3d", "VRChat", "VRChat")
      );
      candidates.push(
        path.join(process.env.HOME, ".config", "VRChat", "VRChat")
      );
      candidates.push(
        path.join(process.env.HOME, ".local", "share", "VRChat", "VRChat")
      );
    }
  }
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.lstatSync(dir).isDirectory()) return dir;
    } catch (e) {}
  }
  return null;
}

// startLogWatcher(): Tail the VRChat output_log file and emit parsed join/leave events.
async function startLogWatcher() {
  try {
    const dir = detectGameLogDir();
    if (!dir) {
      logDebug("Game log directory not found via auto-detect.");
      return;
    }
    logDebug("Game log directory detected:", dir);
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^output_log.*\.txt$/i.test(f));
    if (!files || files.length === 0) {
      logDebug("No output_log_*.txt files found in", dir);
      return;
    }
    let latest = files
      .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)[0].f;
    let currentLogPath = path.join(dir, latest);
    let lastRotationLogAt = 0;
    logDebug("Tailing game log file:", currentLogPath);
    let lastSize = 0;
    try {
      lastSize = fs.statSync(currentLogPath).size;
    } catch {
      lastSize = 0;
    }

    setInterval(async () => {
      try {
        const currentFiles = fs
          .readdirSync(dir)
          .filter((f) => /^output_log.*\.txt$/i.test(f));
        if (currentFiles.length === 0) return;

        const newest = currentFiles
          .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
          .sort((a, b) => b.m - a.m)[0].f;
        const newestPath = path.join(dir, newest);

        if (newestPath !== currentLogPath) {
          const now = Date.now();
          if (now - lastRotationLogAt > 5000) {
            logDebug("Log rotated, switching to", newestPath);
            lastRotationLogAt = now;
          }
          currentLogPath = newestPath;
          try {
            lastSize = fs.statSync(currentLogPath).size;
            return;
          } catch (e) {
            lastSize = 0;
          }
        }

        const st = fs.statSync(currentLogPath);
        if (st.size > lastSize) {
          const rs = fs.createReadStream(currentLogPath, {
            start: lastSize,
            end: st.size - 1,
            encoding: "utf8",
          });
          let buf = "";
          for await (const chunk of rs) buf += chunk;
          const lines = buf.split(/\r?\n/);
          for (const line of lines) {
            if (!line || !line.trim()) continue;
            handleGameLogLine(line);
          }
          lastSize = st.size;
        }
      } catch (err) {
        logDebug(
          "Game log tailing error:",
          err && (err.stack || err.message || err)
        );
      }
    }, 1000);
  } catch (err) {
    logDebug(
      "Failed to start game log watcher:",
      err && (err.stack || err.message || err)
    );
  }
}

// handleGameLogLine(): Process a single game log line and handle OnPlayerJoined/OnPlayerLeft.
async function handleGameLogLine(line) {
  try {
    if (
      line.includes("[Behaviour] OnPlayerJoined") &&
      !line.includes("] OnPlayerJoined:")
    ) {
      const idx = line.lastIndexOf("] OnPlayerJoined");
      if (idx < 0) return;
      const rest = line.substring(idx + 17).trim();
      const { displayName, userId } = parseUserInfoFromLog(rest);
      logDebug("GameLog OnPlayerJoined parsed:", { displayName, userId });
      if (!userId) {
        logDebug(
          "Join event contained no userId, skipping group check for",
          displayName
        );
        return;
      }
      await processPlayerJoin(userId, displayName);
      return;
    }

    if (
      line.includes("[Behaviour] OnPlayerLeft") &&
      !line.includes("] OnPlayerLeftRoom") &&
      !line.includes("] OnPlayerLeft:")
    ) {
      const idx = line.lastIndexOf("] OnPlayerLeft");
      if (idx < 0) return;
      const rest = line.substring(idx + 15).trim();
      const { displayName, userId } = parseUserInfoFromLog(rest);
      logDebug("GameLog OnPlayerLeft parsed:", { displayName, userId });
      if (userId && recentlySeenJoins.has(userId))
        recentlySeenJoins.delete(userId);
      return;
    }
  } catch (e) {
    logDebug("Error handling game log line:", e && (e.stack || e.message || e));
  }
}

// processPlayerJoin(): Handle a player join: dedupe, ignore self, check groups, notify on match.
async function processPlayerJoin(userId, displayName) {
  try {
    if (!userId || typeof userId !== "string") {
      logDebug("processPlayerJoin called with invalid userId:", userId);
      return;
    }

    if (recentlySeenJoins.has(userId)) {
      logDebug("Duplicate join ignored for", userId);
      return;
    }
    recentlySeenJoins.add(userId);
    setTimeout(() => recentlySeenJoins.delete(userId), 30 * 1000);

    let me;
    try {
      me = await getCurrentUser();
    } catch (e) {
      logDebug(
        "Failed to get current user while processing join:",
        e && e.message ? e.message : e
      );
    }
    if (me && me.id === userId) {
      logDebug("Join is current user, ignoring", userId);
      return;
    }

    logDebug("Processing joined user:", { userId, displayName });

    let groups = [];
    try {
      groups = await getUserGroups(userId);
    } catch (e) {
      logDebug(
        "Failed to fetch groups for",
        userId,
        e && e.message ? e.message : e
      );
    }
    if (!groups || groups.length === 0) {
      logDebug("No groups found for", userId);
      return;
    }

    // If the user is explicitly whitelisted, skip all checks for this user
    if (whitelistUserIds && whitelistUserIds.includes(userId)) {
      logDebug("User is whitelisted, skipping checks for", userId);
      return;
    }

    // Fetch user profile (for displayName/bio keyword checks) but tolerate failures
    const userProfile = await (async () => {
      try {
        return await getUser(userId);
      } catch (e) {
        return null;
      }
    })();

    // helper for keyword detection using regex patterns provided in keywordBlacklist.
    // keywordBlacklist entries are compiled to RegExp objects (keywordRegexes).
    // Patterns are treated as regular expressions (case-insensitive).
    const keywordMatch = (text) => {
      if (!text || !keywordRegexes || !Array.isArray(keywordRegexes))
        return null;
      const str = String(text);
      for (const rx of keywordRegexes) {
        try {
          if (rx.test(str)) return rx.source;
        } catch (e) {
          logDebug(
            "keyword regex test failed:",
            e && (e.message || e),
            rx && rx.source ? rx.source : rx
          );
        }
      }
      return null;
    };

    const matches = [];

    // Check each group the user belongs to
    for (const g of groups) {
      try {
        if (whitelistGroupIds && whitelistGroupIds.includes(g.groupId)) {
          logDebug("Skipping whitelisted group", g.groupId);
          continue;
        }
        // explicit blocked-group by id (supports normalized entries {groupId,reason,severity})
        const blockedEntry = blockedGroups.find(
          (bg) => bg && (bg.groupId === g.groupId || bg.id === g.groupId)
        );
        if (blockedEntry) {
          matches.push({
            type: "blockedGroup",
            group: g,
            entry: blockedEntry,
          });
          continue;
        }
        // keyword checks on group name/description
        const nameMatch = keywordMatch(g.name);
        const descMatch = keywordMatch(g.description);
        const matchedKeyword = nameMatch || descMatch;
        if (matchedKeyword) {
          matches.push({
            type: "keywordGroup",
            group: g,
            keyword: matchedKeyword,
            reason: `keyword match: ${matchedKeyword}`,
            severity: "medium",
          });
        }
      } catch (e) {
        logDebug(
          "Error while checking group",
          g,
          e && (e.stack || e.message || e)
        );
      }
    }

    // Check user displayName / bio for keywords (if present)
    if (userProfile) {
      const nameKw = keywordMatch(userProfile.displayName || displayName);
      const bioKw = keywordMatch(
        userProfile.bio || userProfile.bioDescription || ""
      );
      const matchedUserKeyword = nameKw || bioKw;
      if (matchedUserKeyword) {
        matches.push({
          type: "keywordUser",
          user: userProfile,
          keyword: matchedUserKeyword,
          reason: `user keyword match: ${matchedUserKeyword}`,
          severity: "medium",
        });
      }
    }

    if (matches.length > 0) {
      const details = matches.map((m) => {
        if (m.type === "blockedGroup") {
          return `${m.group.name || m.group.groupId} (${
            m.group.groupId
          }) reason=${m.entry.reason || "n/a"} severity=${
            m.entry.severity || "medium"
          }`;
        }
        if (m.type === "keywordGroup") {
          return `${m.group.name || m.group.groupId} (${
            m.group.groupId
          }) keyword=${m.keyword} severity=${m.severity}`;
        }
        if (m.type === "keywordUser") {
          return `${m.user.displayName || userId} (${userId}) user_keyword=${
            m.keyword
          } severity=${m.severity}`;
        }
        return JSON.stringify(m);
      });

      const alertMsg = `${
        displayName || userId
      } matched blocked criteria: ${details.join("; ")}`;

      console.log(`⚠️ ALERT: ${alertMsg} (${userId})`);
      try {
        windowsNotify(`${alertMsg}`);
      } catch (e) {
        logDebug("windowsNotify failed:", e && (e.stack || e.message || e));
      }
      try {
        await discordNotify(`${alertMsg} (${userId})`);
      } catch (e) {
        logDebug("discordNotify failed:", e && (e.stack || e.message || e));
      }
      try {
        playAlertSound();
      } catch (e) {
        logDebug("playAlertSound failed:", e && (e.stack || e.message || e));
      }

      logDebug("Blocked group/keyword matches for", userId, matches);
    } else {
      logDebug("No blocked groups/keywords for", userId);
    }
  } catch (e) {
    logDebug("Error in processPlayerJoin:", e && (e.stack || e.message || e));
  }
}

// windowsNotify(): Send a Windows system notification.
function findSnoreToastExe() {
  const candidates = [
    // Prefer vendor next to exe (packaged)
    path.join(exeDir, "vendor", "SnoreToast.exe"),
    path.join(exeDir, "vendor", "snoretoast.exe"),
    path.join(exeDir, "vendor", "snoretoast-x64.exe"),
    // Common node_modules locations when running unpackaged / in dev
    path.join(
      process.cwd(),
      "node_modules",
      "node-notifier",
      "vendor",
      "SnoreToast.exe"
    ),
    path.join(
      process.cwd(),
      "node_modules",
      "node-notifier",
      "vendor",
      "snoretoast.exe"
    ),
    path.join(
      process.cwd(),
      "node_modules",
      "node-notifier",
      "vendor",
      "snoretoast-x64.exe"
    ),
    // Fallback to __dirname relative lookup (for bundled cjs)
    typeof __dirname !== "undefined"
      ? path.join(
          __dirname,
          "node_modules",
          "node-notifier",
          "vendor",
          "SnoreToast.exe"
        )
      : null,
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (e) {}
  }
  return null;
}

function windowsNotify(msg) {
  try {
    const snorePath = findSnoreToastExe();
    if (notifier && notifier.WindowsToaster) {
      const opts = {
        title: "VRChat Alert",
        message: msg,
        sound: true,
        wait: false,
      };
      if (snorePath) {
        opts.customPath = snorePath;
        logDebug("Using SnoreToast at:", snorePath);
      } else {
        logDebug(
          "SnoreToast executable not found; using default WindowsToaster behavior."
        );
      }
      try {
        const w = new notifier.WindowsToaster(opts);
        w.notify(opts, function (err, response, metadata) {
          if (err)
            logDebug(
              "WindowsToaster notify error:",
              err && (err.stack || err.message || err)
            );
          else logDebug("WindowsToaster response:", response, metadata);
        });
        return;
      } catch (e) {
        logDebug(
          "WindowsToaster construction/notify failed, falling back:",
          e && (e.stack || e.message || e)
        );
      }
    }

    // Fallback to generic notifier.notify
    const options = {
      title: "VRChat Alert",
      message: msg,
      sound: true,
      wait: false,
    };
    if (snorePath) options.customPath = snorePath;
    notifier.notify(options, (err, response, metadata) => {
      if (err)
        logDebug(
          "notifier.notify error:",
          err && (err.stack || err.message || err)
        );
      else logDebug("notifier.notify response:", response, metadata);
    });
  } catch (e) {
    logDebug("windowsNotify error:", e && (e.stack || e.message || e));
  }
}

// playAlertSound(): Play alert.mp3 natively if enabled in config.
async function playAlertSound() {
  try {
    logDebug("playAlertSound invoked", {
      playSound,
      platform: process.platform,
    });
    if (!playSound) {
      logDebug("playAlertSound skipped because playSound=false in config.");
      return;
    }

    const candidates = [
      path.join(exeDir, "alert.mp3"),
      path.join(process.cwd(), "alert.mp3"),
      // __dirname may exist in bundled cjs builds
      typeof __dirname !== "undefined"
        ? path.join(__dirname, "alert.mp3")
        : null,
    ].filter(Boolean);

    logDebug("playAlertSound candidates:", candidates);
    const mp3Path = candidates.find((p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    });

    if (!mp3Path) {
      logDebug("Alert sound file not found; looked at:", candidates);
      return;
    }

    logDebug("playAlertSound selected file:", mp3Path);

    // Only use bundled ffplay (quiet playback, no UI). Do not fall back to other methods.
    const ffplayCandidates = [
      path.join(exeDir, "vendor", "ffplay.exe"),
      path.join(exeDir, "vendor", "ffplay"),
      path.join(process.cwd(), "vendor", "ffplay.exe"),
      path.join(process.cwd(), "vendor", "ffplay"),
      // __dirname fallback
      typeof __dirname !== "undefined"
        ? path.join(__dirname, "vendor", "ffplay.exe")
        : null,
      typeof __dirname !== "undefined"
        ? path.join(__dirname, "vendor", "ffplay")
        : null,
    ].filter(Boolean);

    const ffplayPath = ffplayCandidates.find((p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    });

    if (!ffplayPath) {
      logDebug(
        "ffplay not found in vendor; playback disabled. Place ffplay in vendor/ffplay or vendor/ffplay.exe next to the exe."
      );
      return;
    }

    logDebug("playAlertSound using bundled ffplay:", ffplayPath);
    // Pass volume via ffplay audio filter; playVolume expected 0.0 - 1.0
    const args = [
      "-nodisp",
      "-autoexit",
      "-loglevel",
      "quiet",
      "-af",
      `volume=${playVolume}`,
      mp3Path,
    ];
    const cp = execFile(
      ffplayPath,
      args,
      { windowsHide: true },
      (err, stdout, stderr) => {
        if (err)
          logDebug(
            "ffplay playback error:",
            err && (err.stack || err.message || err)
          );
        if (stdout && stdout.toString().trim())
          logDebug("ffplay stdout:", stdout.toString());
        if (stderr && stderr.toString().trim())
          logDebug("ffplay stderr:", stderr.toString());
        if (!err) logDebug("ffplay finished without error");
      }
    );
    try {
      logDebug("ffplay started pid:", cp && cp.pid);
    } catch {}
    return;
  } catch (e) {
    logDebug(
      "playAlertSound unexpected error:",
      e && (e.stack || e.message || e)
    );
  }
}

// discordNotify(): Send a Discord webhook notification if configured.
async function discordNotify(msg) {
  if (!discordWebhook) return;
  logDebug("Sending Discord notification:", msg);
  try {
    await fetch(discordWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `⚠️ ${msg}` }),
    });
  } catch (e) {
    logDebug("discordNotify fetch failed:", e && (e.stack || e.message || e));
    throw e;
  }
}

// triggerTestNotification(): Trigger a test notification (debug only) via Windows/Discord.
async function triggerTestNotification() {
  if (!debug) {
    logDebug("Test notification suppressed because debug=false");
    return;
  }
  const testMsg = `TEST ALERT: Simulated blocked-group detection at ${new Date().toLocaleTimeString()}`;
  console.log(`→ Emitting test notification: ${testMsg}`);
  windowsNotify(testMsg);
  try {
    playAlertSound();
  } catch (e) {
    logDebug("playAlertSound failed (test):", e && (e.stack || e.message || e));
  }
  try {
    await discordNotify(testMsg);
  } catch (e) {
    logDebug("discordNotify failed (test):", e && (e.message || e));
  }
}

// loadBlockedGroups(): Optionally fetch remote blockedGroups and update local file,
async function loadBlockedGroups() {
  try {
    if (!blockedGroupsAutoUpdate) {
      logDebug("blockedGroupsAutoUpdate disabled in config.");
    } else if (!blockedGroupsRemoteUrl) {
      logDebug(
        "blockedGroupsRemoteUrl missing; skipping blocked groups update."
      );
    } else {
      logDebug(
        "Attempting to update blockedGroups from remote:",
        blockedGroupsRemoteUrl
      );
      try {
        const res = await fetch(blockedGroupsRemoteUrl, {
          headers: { "User-Agent": "VRChatMonitor/1.0 (hubert@wolfyo.eu)" },
        });
        if (res.ok) {
          const text = await res.text();
          let remoteParsed;
          try {
            remoteParsed = parse(text);
          } catch (e) {
            logDebug(
              "Failed to parse remote blockedGroups JSONC:",
              e && e.message ? e.message : e
            );
            remoteParsed = null;
          }
          const remoteArray =
            remoteParsed && Array.isArray(remoteParsed.blockedGroups)
              ? remoteParsed.blockedGroups
              : null;
          if (remoteArray) {
            let localText = "";
            try {
              // Prefer local file placed next to the exe (writeableDir) or current working dir.
              if (fs.existsSync(blockedGroupsPath)) {
                localText = fs.readFileSync(blockedGroupsPath, "utf-8");
              } else {
                try {
                  localText = readBundledOrExternal(
                    "blockedGroups.jsonc",
                    null
                  );
                } catch {
                  localText = null;
                }
              }
            } catch (e) {
              logDebug(
                "Local blockedGroups.jsonc not found or unreadable:",
                e && e.message ? e.message : e
              );
              localText = null;
            }
            let localParsed = null;
            let localArray = [];
            if (localText != null) {
              try {
                localParsed = parse(localText);
                localArray = Array.isArray(localParsed.blockedGroups)
                  ? localParsed.blockedGroups
                  : [];
              } catch (e) {
                logDebug(
                  "Failed to parse local blockedGroups.jsonc:",
                  e && e.message ? e.message : e
                );
                localArray = [];
              }
            }
            // Normalize relevant parts of remote/local configs and compare them.
            // Comparison now considers:
            // - blockedGroups entries (by groupId + stable fields)
            // - keywordBlacklist
            // - whitelistGroupIds
            // - whitelistUserIds
            // - appVersion / version
            const normalizeConfig = (obj) => {
              const parsedObj = obj || {};
              const appVersion =
                parsedObj.appVersion || parsedObj.version || null;
              const keywordBlacklistArr = Array.isArray(
                parsedObj.keywordBlacklist
              )
                ? parsedObj.keywordBlacklist
                    .slice()
                    .map(String)
                    .filter(Boolean)
                    .sort()
                : [];
              const whitelistGroupIdsArr = Array.isArray(
                parsedObj.whitelistGroupIds
              )
                ? parsedObj.whitelistGroupIds
                    .slice()
                    .map(String)
                    .filter(Boolean)
                    .sort()
                : [];
              const whitelistUserIdsArr = Array.isArray(
                parsedObj.whitelistUserIds
              )
                ? parsedObj.whitelistUserIds
                    .slice()
                    .map(String)
                    .filter(Boolean)
                    .sort()
                : [];
              const blockedRaw = Array.isArray(parsedObj.blockedGroups)
                ? parsedObj.blockedGroups
                : [];
              const blockedNormalized = blockedRaw
                .map((entry) => {
                  if (typeof entry === "string")
                    return { groupId: String(entry) };
                  if (!entry || typeof entry !== "object") return null;
                  return {
                    groupId: entry.groupId || entry.id || null,
                    // we keep name/reason/severity for informational comparison
                    name: entry.name || entry.note || null,
                    reason: entry.reason || null,
                    severity: entry.severity || null,
                  };
                })
                .filter(Boolean)
                .sort((a, b) =>
                  String(a.groupId || "").localeCompare(String(b.groupId || ""))
                );
              return JSON.stringify({
                appVersion,
                keywordBlacklist: keywordBlacklistArr,
                whitelistGroupIds: whitelistGroupIdsArr,
                whitelistUserIds: whitelistUserIdsArr,
                blockedGroups: blockedNormalized,
              });
            };

            // remoteParsed and localParsed exist earlier in this function's scope.
            const remoteCanonical = normalizeConfig(remoteParsed || {});
            const localCanonical = normalizeConfig(localParsed || {});

            if (remoteCanonical === localCanonical) {
              logDebug(
                "Remote blockedGroups/config identical to local; no update needed."
              );
            } else {
              try {
                try {
                  fs.writeFileSync(blockedGroupsPath, text);
                  console.log(
                    "💾 blockedGroups.jsonc updated from remote source."
                  );
                  logDebug(
                    "blockedGroups.jsonc updated from",
                    blockedGroupsRemoteUrl
                  );
                } catch (e) {
                  logDebug(
                    "Failed to write updated blockedGroups.jsonc:",
                    e && (e.stack || e.message || e)
                  );
                }
              } catch (e) {
                logDebug(
                  "Failed to write updated blockedGroups.jsonc:",
                  e && (e.stack || e.message || e)
                );
              }
            }
          } else {
            logDebug(
              "Remote file did not contain 'blockedGroups' array; skipping update."
            );
          }
        } else {
          logDebug(
            "Failed to fetch blockedGroups remote:",
            res.status,
            res.statusText
          );
        }
      } catch (e) {
        logDebug(
          "Error fetching remote blockedGroups:",
          e && (e.stack || e.message || e)
        );
      }
    }
  } catch (e) {
    logDebug(
      "Unexpected error in loadBlockedGroups:",
      e && (e.stack || e.message || e)
    );
  }
  try {
    const bgText = (() => {
      if (fs.existsSync(blockedGroupsPath))
        return fs.readFileSync(blockedGroupsPath, "utf-8");
      try {
        return readBundledOrExternal(
          "blockedGroups.jsonc",
          '{"blockedGroups": []}'
        );
      } catch {
        return '{"blockedGroups": []}';
      }
    })();
    try {
      const parsed = parse(bgText);

      // If blockedGroups.jsonc contains an appVersion/version field, compare it to APP_VERSION
      // and notify the user if the versions differ.
      try {
        const remoteVersion = parsed && (parsed.appVersion || parsed.version);
        if (remoteVersion) {
          await checkAppVersion(String(remoteVersion));
        }
      } catch (e) {
        logDebug("App version check failed:", e && (e.message || e));
      }

      // If the blockedGroups.jsonc contains keyword blacklist or whitelist info,
      // prefer those values over the config defaults.
      if (parsed) {
        if (Array.isArray(parsed.keywordBlacklist)) {
          keywordBlacklist = parsed.keywordBlacklist;
          // Compile user-provided patterns into RegExp objects (case-insensitive).
          // Treat each entry in keywordBlacklist as a regex pattern string.
          keywordRegexes = keywordBlacklist
            .map((p) => {
              try {
                return new RegExp(p, "i");
              } catch (e) {
                logDebug(
                  "Invalid keyword regex pattern in blockedGroups.jsonc:",
                  p,
                  e && (e.message || e)
                );
                return null;
              }
            })
            .filter(Boolean);
          logDebug(
            "Loaded keywordBlacklist (compiled to regexes) from blockedGroups.jsonc:",
            keywordBlacklist,
            keywordRegexes.map((r) => r.source)
          );
        }
        if (Array.isArray(parsed.whitelistGroupIds)) {
          whitelistGroupIds = parsed.whitelistGroupIds;
          logDebug(
            "Loaded whitelistGroupIds from blockedGroups.jsonc:",
            whitelistGroupIds
          );
        }
        if (Array.isArray(parsed.whitelistUserIds)) {
          whitelistUserIds = parsed.whitelistUserIds;
          logDebug(
            "Loaded whitelistUserIds from blockedGroups.jsonc:",
            whitelistUserIds
          );
        }
      }

      const raw = Array.isArray(parsed.blockedGroups)
        ? parsed.blockedGroups
        : [];
      // Normalize entries to objects: { groupId, reason, severity }
      blockedGroups = raw
        .map((entry) => {
          if (typeof entry === "string") {
            return { groupId: entry, reason: null, severity: "medium" };
          }
          if (entry && typeof entry === "object") {
            return {
              groupId: entry.groupId || entry.id || null,
              reason: entry.reason || entry.note || null,
              severity: entry.severity || "medium",
            };
          }
          return null;
        })
        .filter(Boolean);
    } catch (e) {
      logDebug(
        "Failed to parse local blockedGroups.jsonc into memory:",
        e && (e.stack || e.message || e)
      );
      blockedGroups = [];
    }
  } catch (e) {
    logDebug(
      "Failed to load local blockedGroups.jsonc into memory:",
      e && (e.stack || e.message || e)
    );
    blockedGroups = [];
  }
}

// main(): Application entrypoint that logs in, starts watchers, and enables terminal controls.
(async () => {
  console.log("🔍 VRChat Instance Monitor Starting...");
  fs.writeFileSync(
    debugLogFile,
    `=== Debug log started ${new Date().toISOString()} ===\n`
  );
  await loadBlockedGroups();
  await login();
  startLogWatcher().catch((e) =>
    logDebug("startLogWatcher failed:", e && (e.stack || e.message || e))
  );
  console.log("🔍 Monitoring your instance for blocked group members...");

  try {
    if (process.stdin && process.stdin.setRawMode) {
      if (debug) console.log("ℹ️ Press 't' to emit a test alert, 'q' to quit.");
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("data", async (chunk) => {
        const key = chunk.toString();
        if (key === "t") {
          if (debug) {
            await triggerTestNotification();
          } else {
            process.stdout.write(
              "\rTest notifications are disabled (debug=false). "
            );
          }
        } else if (key === "q" || key === "\u0003") {
          console.log("Exiting by user request.");
          process.exit(0);
        } else if (key === "\r") {
        } else {
          process.stdout.write(
            "\rPress 't' to test alert (debug only), 'q' to quit. "
          );
        }
      });
    } else {
      console.log("ℹ️ Interactive stdin not available; test trigger disabled.");
    }
  } catch (e) {
    logDebug(
      "Failed to activate terminal test controls:",
      e && (e.stack || e.message || e)
    );
  }
})();
