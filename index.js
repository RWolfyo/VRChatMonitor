import fetch from "node-fetch";
import fs from "fs";
import readlineSync from "readline-sync";
import notifier from "node-notifier";
import path from "path";
import { parse } from "jsonc-parser";

const API = "https://api.vrchat.cloud/api/1";
const debugLogFile = path.resolve("./debug.log");

const config = JSON.parse(fs.readFileSync("config.json", "utf-8"));
const {
  discordWebhook,
  debug,
  blockedGroupsAutoUpdate = true,
  blockedGroupsRemoteUrl = null,
} = config;

let blockedGroups = []; // will be populated by loadBlockedGroups()

let authHeaders = {};
let cookies = "";
const sessionFile = path.resolve("./session.json");
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

// login(): Perform login to VRChat and persist session cookies (prompts for credentials/2FA).
async function login() {
  if (fs.existsSync(sessionFile)) {
    const session = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
    cookies = session.cookies || "";
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

    const setCookie = res.headers.raw()["set-cookie"];
    cookies = parseCookies(setCookie);
    authHeaders = {
      "User-Agent": "VRChatMonitor/1.0 (hubert@wolfyo.eu)",
      Cookie: cookies,
    };
  }

  fs.writeFileSync(sessionFile, JSON.stringify({ cookies }, null, 2));
  console.log("💾 Session saved.");

  res = await fetch(`${API}/auth/user`, { headers: authHeaders });
  data = await res.json();
  logDebug("Final login user data:", data);

  if (!res.ok || !data.id) throw new Error("Login failed after 2FA.");
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

    const matches = groups.filter((g) => blockedGroups.includes(g.groupId));

    if (matches.length > 0) {
      const groupDescriptions = matches.map(
        (m) => `${m.name || m.groupId} (${m.groupId})`
      );
      const alertMsg = `${displayName || userId} is in blocked group${
        matches.length > 1 ? "s" : ""
      }: ${groupDescriptions.join(", ")}`;

      console.log(`⚠️ ALERT: ${alertMsg} (${userId})`);
      try {
        windowsNotify(alertMsg);
      } catch (e) {
        logDebug("windowsNotify failed:", e && (e.stack || e.message || e));
      }
      try {
        await discordNotify(`${alertMsg} (${userId})`);
      } catch (e) {
        logDebug("discordNotify failed:", e && (e.stack || e.message || e));
      }

      logDebug("Blocked group matches for", userId, matches);
    } else {
      logDebug("No blocked groups for", userId);
    }
  } catch (e) {
    logDebug("Error in processPlayerJoin:", e && (e.stack || e.message || e));
  }
}

// windowsNotify(): Send a Windows system notification.
function windowsNotify(msg) {
  try {
    notifier.notify({
      title: "VRChat Alert",
      message: msg,
      sound: true,
      wait: false,
    });
  } catch (e) {
    logDebug("windowsNotify error:", e && (e.stack || e.message || e));
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
              localText = fs.readFileSync("blockedGroups.jsonc", "utf-8");
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
            const arraysEqual = (a, b) => {
              if (!Array.isArray(a) || !Array.isArray(b)) return false;
              if (a.length !== b.length) return false;
              for (let i = 0; i < a.length; i++)
                if (a[i] !== b[i]) return false;
              return true;
            };
            if (arraysEqual(remoteArray, localArray)) {
              logDebug(
                "Remote blockedGroups identical to local; no update needed."
              );
            } else {
              try {
                // Prefer writing the fetched text to preserve comments/formatting if available
                fs.writeFileSync("blockedGroups.jsonc", text);
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
  // finally, ensure blockedGroups variable is loaded from the local file
  try {
    blockedGroups = parse(
      fs.readFileSync("blockedGroups.jsonc", "utf-8")
    ).blockedGroups;
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
