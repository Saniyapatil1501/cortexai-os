import {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  Notification,
} from "electron";
import * as path from "path";
import { exec, spawn, ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import * as fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let backendProcess: ChildProcess | null = null;

function startBackend() {
  // Determine command path to backend folder
  const isDev = !app.isPackaged;
  const scriptPath = path.join(__dirname, "../backend/main.py");
  const backendDir = path.join(__dirname, "../backend");

  if (isDev) {
    console.log("Launching local FastAPI server in development mode...");

    // Prioritize locating local virtual environment python binary
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

    // Spawns the local FastAPI python script with backend folder as working directory
    // Using "-u" parameter ensures unbuffered real-time stdout/stderr prints
    backendProcess = spawn(pythonCmd, ["-u", scriptPath], {
      cwd: backendDir,
      shell: true,
    });

    backendProcess.stdout?.on("data", (data) => {
      console.log(`[FastAPI] ${data.toString().trim()}`);
    });

    backendProcess.stderr?.on("data", (data) => {
      console.error(`[FastAPI Stderr] ${data.toString().trim()}`);
    });

    backendProcess.on("error", (err) => {
      console.error(`Failed to start FastAPI daemon: ${err.message}`);
    });

    backendProcess.on("close", (code) => {
      console.log(`FastAPI daemon exited with code ${code}`);
    });
  }
}

function killBackend() {
  if (backendProcess && backendProcess.pid) {
    const pid = backendProcess.pid;
    console.log(`Terminating backend process tree for PID: ${pid}`);
    if (process.platform === "win32") {
      exec(`taskkill /F /T /PID ${pid}`, (error) => {
        if (error) {
          console.error(`Error killing process tree on Windows: ${error.message}`);
        } else {
          console.log(`Cleaned up process tree for PID ${pid}`);
        }
      });
    } else {
      try {
        process.kill(-pid, "SIGKILL");
        console.log(`Sent SIGKILL to process group ${pid}`);
      } catch (e: any) {
        console.error(`Error killing process group on Unix: ${e.message}`);
        try {
          backendProcess.kill("SIGKILL");
        } catch {}
      }
    }
    backendProcess = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false, // Premium frameless SaaS layout
    transparent: false,
    backgroundColor: "#141416",
    titleBarStyle: "hidden", // Frameless with client controls
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
    // In development mode, load Vite's local dev server port
    mainWindow.loadURL("http://localhost:3000");
  } else {
    // In production, load the compiled static static bundle
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.once("ready-to-show", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
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
        killBackend();
        app.quit();
      },
    },
  ]);

  tray.setToolTip("CortexAI Dashboard");
  tray.setContextMenu(contextMenu);
}

app.whenReady().then(() => {
  // Set AppUserModelId for native Windows Toast Notifications
  app.setAppUserModelId("com.cortexai.os");

  startBackend();
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

app.on("window-all-closed", () => {
  killBackend();
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
