const { BrowserWindow } = require("electron");
const path = require("path");

function createMainWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, "../../preload/index.js"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    win.once("ready-to-show", () => {
        win.maximize();
        win.show();
    });
    win.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
        console.error("Renderer failed to load:", errorCode, errorDescription);
        win.show();
    });

    // Dev server URL can be set when running with Vite.
    if (process.env.ELECTRON_RENDERER_URL) {
        win.loadURL(process.env.ELECTRON_RENDERER_URL);
        return win;
    }

    win.loadFile(path.join(__dirname, "../../../frontend/dist/index.html"));
    return win;
}

module.exports = {
    createMainWindow,
};
