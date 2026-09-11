import {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  Notification,
  desktopCapturer,
  screen,
  dialog,
} from "electron";
import * as path from "path";
import { exec, execSync, spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as http from "http";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let cortexViteProcess: ChildProcess | null = null;
let cortexFastApiProcess: ChildProcess | null = null;
let ownsVite = false;
let ownsFastApi = false;
let isShuttingDown = false;
let cleanupExecuted = false;

function verifyCortexBackend(): Promise<"free" | "ours" | "conflict"> {
  return new Promise((resolve) => {
    let completed = false;
    let req: any;

    const timer = setTimeout(() => {
      if (completed) return;
      completed = true;
      if (req) req.destroy();
      console.log("[FastAPI] Port 8000 check timed out (manual trigger).");
      resolve("conflict");
    }, 2000);

    const tryRequest = (host: string) => {
      req = http.request(
        {
          method: "GET",
          hostname: host,
          port: 8000,
          path: "/",
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            if (completed) return;
            completed = true;
            clearTimeout(timer);
            try {
              const json = JSON.parse(data);
              if (json.status === "online" && json.service === "CortexAI Desktop Daemon") {
                console.log(`[FastAPI] Existing server detected on port 8000 (via ${host}).`);
                console.log("[FastAPI] Health check successful.");
                console.log("[FastAPI] Reusing existing server.");
                resolve("ours");
              } else {
                console.log("[FastAPI] Port 8000 is occupied but the service is not a healthy CortexAI backend.");
                resolve("conflict");
              }
            } catch (completedErr) {
              console.log("[FastAPI] Port 8000 is occupied but health check failed (invalid JSON response).");
              resolve("conflict");
            }
          });
        }
      );

      req.on("error", (err: any) => {
        if (completed) return;

        // If "127.0.0.1" failed, try "localhost" as fallback
        if (host === "127.0.0.1") {
          tryRequest("localhost");
          return;
        }

        completed = true;
        clearTimeout(timer);
        if (err.code === "ECONNREFUSED") {
          resolve("free");
        } else {
          console.log(`[FastAPI] Port 8000 connection error on ${host}: ${err.message}`);
          resolve("conflict");
        }
      });

      req.end();
    };

    tryRequest("127.0.0.1");
  });
}

function verifyCortexFrontend(): Promise<"none" | "ours" | "unrelated"> {
  return new Promise((resolve) => {
    let completed = false;
    let req: any;

    const timer = setTimeout(() => {
      if (completed) return;
      completed = true;
      if (req) req.destroy();
      resolve("none");
    }, 2000);

    const tryRequest = (host: string) => {
      req = http.request(
        {
          method: "GET",
          hostname: host,
          port: 3000,
          path: "/",
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            if (completed) return;
            completed = true;
            clearTimeout(timer);

            const isRedirectToLogin =
              (res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 301) &&
              res.headers.location?.includes("/login");

            const serverHeader = res.headers["server"];
            const isViteServer = typeof serverHeader === "string" && serverHeader.toLowerCase().includes("vite");

            if (
              isRedirectToLogin ||
              data.includes("CortexAI") ||
              data.includes("cortexai-os") ||
              data.includes("/@vite/client") ||
              res.headers["x-powered-by"]?.includes("Vite") ||
              isViteServer
            ) {
              resolve("ours");
            } else {
              // Fallback: Fetch /login directly to verify
              let subReq: any;
              const subTimer = setTimeout(() => {
                if (completed) return;
                completed = true;
                if (subReq) subReq.destroy();
                resolve("unrelated");
              }, 1500);

              subReq = http.request(
                {
                  method: "GET",
                  hostname: host,
                  port: 3000,
                  path: "/login",
                },
                (subRes) => {
                  let subData = "";
                  subRes.on("data", (subChunk) => {
                    subData += subChunk;
                  });
                  subRes.on("end", () => {
                    if (completed) return;
                    completed = true;
                    clearTimeout(subTimer);
                    const subServerHeader = subRes.headers["server"];
                    const isSubViteServer = typeof subServerHeader === "string" && subServerHeader.toLowerCase().includes("vite");
                    if (
                      subData.includes("CortexAI") ||
                      subData.includes("cortexai-os") ||
                      subData.includes("/@vite/client") ||
                      subRes.headers["x-powered-by"]?.includes("Vite") ||
                      isSubViteServer
                    ) {
                      resolve("ours");
                    } else {
                      resolve("unrelated");
                    }
                  });
                }
              );
              subReq.on("error", () => {
                if (completed) return;
                completed = true;
                clearTimeout(subTimer);
                resolve("unrelated");
              });
              subReq.end();
            }
          });
        }
      );

      req.on("error", () => {
        if (completed) return;

        // If "127.0.0.1" failed, try "localhost" as fallback
        if (host === "127.0.0.1") {
          tryRequest("localhost");
          return;
        }

        completed = true;
        clearTimeout(timer);
        resolve("none");
      });

      req.end();
    };

    tryRequest("127.0.0.1");
  });
}

function checkUrlReady(urlStr: string): Promise<boolean> {
  return new Promise((resolve) => {
    let completed = false;
    let req: any;

    const tryRequest = (host: string) => {
      try {
        const url = new URL(urlStr);
        req = http.request(
          {
            method: "GET",
            hostname: host,
            port: url.port,
            path: url.pathname || "/",
          },
          (res) => {
            if (completed) return;
            completed = true;
            resolve(res.statusCode !== undefined);
          }
        );

        req.on("error", () => {
          if (completed) return;

          // If "127.0.0.1" failed, try "localhost" as fallback
          if (host === "127.0.0.1") {
            tryRequest("localhost");
            return;
          }

          completed = true;
          resolve(false);
        });

        req.end();
      } catch {
        if (!completed) {
          completed = true;
          resolve(false);
        }
      }
    };

    try {
      const url = new URL(urlStr);
      const initialHost = url.hostname === "localhost" ? "127.0.0.1" : url.hostname;
      tryRequest(initialHost);
    } catch {
      completed = true;
      resolve(false);
    }
  });
}

async function waitForUrl(urlStr: string, timeoutMs: number = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await checkUrlReady(urlStr);
    if (ready) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function ensureFrontendRunning() {
  const isDev = !app.isPackaged;
  if (!isDev) return;

  const status = await verifyCortexFrontend();
  if (status === "ours") {
    console.log("CortexAI Vite dev server is already running on port 3000. Reusing it.");
    ownsVite = false;
    return;
  } else if (status === "unrelated") {
    console.error("==================================================");
    console.error("[CONFLICT] Port 3000 is occupied by an unrelated service!");
    console.error("CortexAI will not spawn or manage Vite dev server on port 3000.");
    console.error("==================================================");
    ownsVite = false;
    return;
  }

  console.log("Vite dev server not detected. Launching local Vite dev server...");
  const projectDir = path.join(__dirname, "..");
  const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
  try {
    cortexViteProcess = spawn(cmd, ["vite", "dev"], {
      cwd: projectDir,
      detached: process.platform !== "win32",
      shell: process.platform === "win32",
    });
    ownsVite = true;

    cortexViteProcess.stdout?.on("data", (data) => {
      console.log(`[Vite] ${data.toString().trim()}`);
    });

    cortexViteProcess.stderr?.on("data", (data) => {
      console.error(`[Vite Stderr] ${data.toString().trim()}`);
    });

    cortexViteProcess.on("error", (err) => {
      console.error(`Failed to start Vite dev server process: ${err.message}`);
    });
  } catch (spawnErr: any) {
    console.error(`Error executing spawn for Vite dev server: ${spawnErr.message}`);
    ownsVite = false;
  }
}

async function startBackend() {
  const isDev = !app.isPackaged;
  const scriptPath = path.join(__dirname, "../backend/main.py");
  const backendDir = path.join(__dirname, "../backend");

  if (!isDev) return;

  const status = await verifyCortexBackend();
  if (status === "ours") {
    ownsFastApi = false;
    return;
  } else if (status === "conflict") {
    console.error("==================================================");
    console.error("[CONFLICT] Port 8000 is occupied by an unrelated or unhealthy service!");
    console.error("CortexAI will not spawn or manage FastAPI backend on port 8000.");
    console.error("==================================================");
    ownsFastApi = false;
    return;
  }

  console.log("Launching local FastAPI server in development mode...");

  let pythonCmd = "python";
  const venvPythonWindows = path.join(__dirname, "../backend/venv/Scripts/python.exe");
  const venvPythonUnix = path.join(__dirname, "../backend/venv/bin/python");

  if (fs.existsSync(venvPythonWindows)) {
    pythonCmd = venvPythonWindows;
  } else if (fs.existsSync(venvPythonUnix)) {
    pythonCmd = venvPythonUnix;
  }

  console.log(`Using Python command: ${pythonCmd}`);
  console.log(`Using Backend working directory: ${backendDir}`);

  try {
    cortexFastApiProcess = spawn(pythonCmd, ["-u", scriptPath], {
      cwd: backendDir,
      detached: process.platform !== "win32",
    });
    ownsFastApi = true;

    cortexFastApiProcess.stdout?.on("data", (data) => {
      console.log(`[FastAPI] ${data.toString().trim()}`);
    });

    cortexFastApiProcess.stderr?.on("data", (data) => {
      console.error(`[FastAPI Stderr] ${data.toString().trim()}`);
    });

    cortexFastApiProcess.on("error", (err) => {
      console.error(`Failed to start FastAPI daemon: ${err.message}`);
    });

    cortexFastApiProcess.on("close", (code) => {
      console.log(`FastAPI daemon exited with code ${code}`);
      cortexFastApiProcess = null;
      ownsFastApi = false;
      if (!isShuttingDown) {
        handleBackendRestart();
      }
    });
  } catch (spawnErr: any) {
    console.error(`Error executing spawn for FastAPI daemon: ${spawnErr.message}`);
    ownsFastApi = false;
  }
}

let restartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 3;
let lastRestartTime = 0;
const RESTART_COOLDOWN_MS = 5000;

async function handleBackendRestart() {
  if (!ownsFastApi) {
    console.log("[Electron] Backend process was not owned by CortexAI. Skipping restart.");
    return;
  }

  const now = Date.now();
  if (now - lastRestartTime < RESTART_COOLDOWN_MS) {
    console.log(`[Electron] Restart requested too quickly. Cooldown active.`);
    return;
  }

  if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
    console.error(`[Electron] Maximum FastAPI restart attempts (${MAX_RESTART_ATTEMPTS}) reached. Stopping automatic restarts.`);
    return;
  }

  restartAttempts++;
  lastRestartTime = now;
  console.log(`[Electron] Attempting to restart FastAPI backend (Attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS})...`);

  await startBackend();

  const ready = await waitForUrl("http://127.0.0.1:8000/", 10000);
  if (ready) {
    console.log(`[Electron] Restarted FastAPI backend is ready.`);
    restartAttempts = 0;
  } else {
    console.error(`[Electron] Restarted FastAPI backend failed to become ready in time.`);
  }
}

function killProcesses() {
  if (cleanupExecuted) {
    console.log("[Electron] Cleanup already executed. Skipping.");
    return;
  }
  cleanupExecuted = true;
  isShuttingDown = true;

  console.log("[Electron] Initiating process cleanup...");

  if (ownsFastApi && cortexFastApiProcess && cortexFastApiProcess.pid) {
    const pid = cortexFastApiProcess.pid;
    console.log(`[Electron] Terminating owned FastAPI process tree for PID: ${pid}`);

    try {
      console.log("[Electron] Requesting graceful shutdown of FastAPI backend...");
      const req = http.request({
        method: "POST",
        hostname: "127.0.0.1",
        port: 8000,
        path: "/api/shutdown",
        timeout: 1000,
      });
      req.on("error", () => {});
      req.end();
    } catch (e: any) {
      console.log("[Electron] Graceful shutdown request failed.");
    }

    try {
      if (process.platform === "win32") {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
      } else {
        process.kill(-pid, "SIGKILL");
      }
      console.log(`[Electron] Cleaned up backend process tree for PID ${pid}`);
    } catch (error: any) {
      console.error(`[Electron] Error killing backend process tree: ${error.message}`);
    }
    cortexFastApiProcess = null;
    ownsFastApi = false;
  } else {
    console.log("[Electron] No owned FastAPI process to clean up.");
  }

  if (ownsVite && cortexViteProcess && cortexViteProcess.pid) {
    const pid = cortexViteProcess.pid;
    console.log(`[Electron] Terminating owned Vite process tree for PID: ${pid}`);
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
      } else {
        process.kill(-pid, "SIGKILL");
      }
      console.log(`[Electron] Cleaned up Vite process tree for PID ${pid}`);
    } catch (error: any) {
      console.error(`[Electron] Error killing Vite process tree: ${error.message}`);
    }
    cortexViteProcess = null;
    ownsVite = false;
  } else {
    console.log("[Electron] No owned Vite process to clean up.");
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false, // Premium frameless SaaS layout
    transparent: false,
    backgroundColor: "#141416",
    titleBarStyle: "hidden", // Frameless with client controls
    show: false, // Keep it hidden until fully loaded
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      partition: "persist:cortexai-session",
      backgroundThrottling: false, // Prevents background timers from throttling when minimized
    },
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    console.log("Waiting for Vite dev server to be ready on port 3000...");
    const frontendReady = await waitForUrl("http://localhost:3000/", 120000);
    if (!frontendReady) {
      console.error("Vite dev server failed to become ready in time.");
      dialog.showErrorBox("Startup Error", "Vite dev server failed to start within 120 seconds. Please check the terminal for errors.");
      app.quit();
      return;
    }
    console.log("Waiting for FastAPI backend to be ready on port 8000...");
    const backendReady = await waitForUrl("http://127.0.0.1:8000/", 8000);
    if (!backendReady) {
      console.error("FastAPI backend failed to become ready in time. Proceeding with UI launch...");
    }

    // In development mode, load Vite's local dev server port
    mainWindow.loadURL("http://localhost:3000");
  } else {
    console.log("Waiting for FastAPI backend to be ready on port 8000...");
    const backendReady = await waitForUrl("http://127.0.0.1:8000/", 8000);
    if (!backendReady) {
      console.error("FastAPI backend failed to become ready in time. Proceeding with UI launch...");
    }

    // In production, load the compiled static static bundle
    const prodPath = path.join(__dirname, "../dist/client/index.html");
    if (fs.existsSync(prodPath)) {
      mainWindow.loadFile(prodPath);
    } else {
      mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
    }
  }

  mainWindow.once("ready-to-show", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  mainWindow.on("close", (event) => {
    if (!isShuttingDown) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createTray() {
  // Create simple native 16x16 B&W image or empty box
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: "Show CortexAI", click: () => mainWindow?.show() },
    { label: "Hide to Tray", click: () => mainWindow?.hide() },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        killProcesses();
        app.quit();
      },
    },
  ]);

  tray.setToolTip("CortexAI Dashboard");
  tray.setContextMenu(contextMenu);
}

app.whenReady().then(async () => {
  // Set AppUserModelId for native Windows Toast Notifications
  app.setAppUserModelId("com.cortexai.os");

  try {
    await startBackend();
  } catch (err: any) {
    console.error("Critical error in startBackend:", err.message);
  }

  try {
    await ensureFrontendRunning();
  } catch (err: any) {
    console.error("Critical error in ensureFrontendRunning:", err.message);
  }

  createWindow();
  createTray();

  // Register Raycast-style global show/hide keyboard hotkey (Ctrl + Alt + Space)
  globalShortcut.register("CommandOrControl+Alt+Space", () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  killProcesses();
});

app.on("will-quit", () => {
  killProcesses();
});

app.on("window-all-closed", () => {
  killProcesses();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Context bridge listeners and commands
ipcMain.handle("notification:trigger", (_, data: { title: string; body: string }) => {
  if (Notification.isSupported()) {
    new Notification({
      title: data.title,
      body: data.body,
    }).show();
  }
});

ipcMain.on("window:minimize", () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on("window:maximize", () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on("window:close", () => {
  if (mainWindow) mainWindow.close();
});

let cachedLensScreenshot: string | null = null;
let lensWindow: BrowserWindow | null = null;
let lensResolve: ((val: string | null) => void) | null = null;

ipcMain.handle("lens:start", async () => {
  if (mainWindow) {
    mainWindow.hide();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.size;

    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: {
        width: Math.floor(width * primaryDisplay.scaleFactor),
        height: Math.floor(height * primaryDisplay.scaleFactor),
      },
    });

    if (sources.length === 0) {
      if (mainWindow) mainWindow.show();
      return null;
    }

    cachedLensScreenshot = sources[0].thumbnail.toDataURL();

    lensWindow = new BrowserWindow({
      width: width,
      height: height,
      x: primaryDisplay.bounds.x,
      y: primaryDisplay.bounds.y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      fullscreen: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    const isDev = !app.isPackaged;
    if (isDev) {
      lensWindow.loadURL("http://localhost:3000/lens-overlay");
    } else {
      const prodPath = path.join(__dirname, "../dist/client/index.html");
      const pageUrl = fs.existsSync(prodPath)
        ? `file://${prodPath}#/lens-overlay`
        : `file://${path.join(__dirname, "../dist/index.html")}#/lens-overlay`;
      lensWindow.loadURL(pageUrl);
    }

    return new Promise<string | null>((resolve) => {
      lensResolve = resolve;
    });
  } catch (err) {
    console.error("Lens capture failed:", err);
    if (mainWindow) mainWindow.show();
    return null;
  }
});

ipcMain.handle("lens:get-screenshot", () => {
  return cachedLensScreenshot;
});

ipcMain.on("lens:complete", (_, croppedBase64: string) => {
  if (lensResolve) {
    lensResolve(croppedBase64);
    lensResolve = null;
  }
  if (lensWindow) {
    lensWindow.close();
    lensWindow = null;
  }
  cachedLensScreenshot = null;
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

ipcMain.on("lens:cancel", () => {
  if (lensResolve) {
    lensResolve(null);
    lensResolve = null;
  }
  if (lensWindow) {
    lensWindow.close();
    lensWindow = null;
  }
  cachedLensScreenshot = null;
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

let companionWindow: BrowserWindow | null = null;

function createCompanionWindow() {
  if (companionWindow) {
    companionWindow.show();
    return;
  }

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  companionWindow = new BrowserWindow({
    width: 90,
    height: 90,
    x: screenWidth - 120,
    y: screenHeight - 120,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    companionWindow.loadURL("http://localhost:3000/#/companion-widget");
  } else {
    const prodPath = path.join(__dirname, "../dist/client/index.html");
    if (fs.existsSync(prodPath)) {
      companionWindow.loadURL(`file://${prodPath}#/companion-widget`);
    } else {
      companionWindow.loadURL(`file://${path.join(__dirname, "../dist/index.html")}#/companion-widget`);
    }
  }

  companionWindow.once("ready-to-show", () => {
    if (companionWindow) companionWindow.show();
  });

  companionWindow.on("closed", () => {
    companionWindow = null;
  });
}

ipcMain.on("companion:show", () => {
  if (mainWindow) {
    mainWindow.hide();
  }
  createCompanionWindow();
});

ipcMain.on("companion:hide", () => {
  if (companionWindow) {
    companionWindow.close();
    companionWindow = null;
  }
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

ipcMain.on("companion:resize", (event, expanded: boolean) => {
  if (!companionWindow) return;
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  if (expanded) {
    companionWindow.setBounds({
      width: 380,
      height: 550,
      x: screenWidth - 400,
      y: screenHeight - 580,
    });
  } else {
    companionWindow.setBounds({
      width: 90,
      height: 90,
      x: screenWidth - 120,
      y: screenHeight - 120,
    });
  }
});

ipcMain.on("companion:context-menu", (event) => {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Chat",
      click: () => {
        event.sender.send("companion:action", "expand-chat");
      },
    },
    {
      label: "Open Main Dashboard",
      click: () => {
        if (companionWindow) {
          companionWindow.close();
          companionWindow = null;
        }
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: "separator" },
    {
      label: "Close Companion Widget",
      click: () => {
        if (companionWindow) {
          companionWindow.close();
          companionWindow = null;
        }
      },
    },
  ]);
  contextMenu.popup({ window: BrowserWindow.fromWebContents(event.sender) || undefined });
});

process.on("SIGINT", () => {
  console.log("SIGINT received. Quitting app...");
  killProcesses();
  app.exit(0);
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received. Quitting app...");
  killProcesses();
  app.exit(0);
});
