const { contextBridge } = require("electron");

// Keep this surface intentionally small. Expand per feature.
contextBridge.exposeInMainWorld("electronAPI", {});
