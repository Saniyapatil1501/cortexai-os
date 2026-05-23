import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut, Notification } from "electron";
import * as path from "path";
import { exec, ChildProcess } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let backendProcess: ChildProcess | null = null;

function startBackend() {
  // Determine command path to backend folder
  const isDev = !app.isPackaged;
  const scriptPath = path.join(__dirname, "../backend/main.py");
  
  if (isDev) {
    console.log("Launching local FastAPI server in development mode...");
    // Spawns the local FastAPI python script
    backendProcess = exec(`python "${scriptPath}"`, (error, stdout, stderr) => {
      if (error) {
        console.error(`FastAPI daemon error: ${error.message}`);
        return;
      }
      if (stderr) {
        console.error(`FastAPI stderr: ${stderr}`);
      }
      console.log(`FastAPI stdout: ${stdout}`);
    });
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
        backendProcess?.kill();
        app.quit();
      },
    },
  ]);

  tray.setToolTip("CortexAI Dashboard");
  tray.setContextMenu(contextMenu);
}

app.whenReady().then(() => {
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
  backendProcess?.kill();
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
