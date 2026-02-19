const {
  getOrCreateCurrentProject,
  saveCurrentProject,
} = require("./projects.service");

async function getCurrentProject(req, res) {
  try {
    const project = await getOrCreateCurrentProject(req.session.userId);
    return res.status(200).json({ project });
  } catch (error) {
    console.error("[projects] getCurrentProject failed:", error.message);
    return res.status(500).json({ message: "Failed to load project" });
  }
}

async function updateCurrentProject(req, res) {
  try {
    const { mediaItems, timelineClips } = req.body;

    if (mediaItems !== undefined && !Array.isArray(mediaItems)) {
      return res.status(400).json({ message: "mediaItems must be an array" });
    }

    if (timelineClips !== undefined && !Array.isArray(timelineClips)) {
      return res.status(400).json({ message: "timelineClips must be an array" });
    }

    const project = await saveCurrentProject(req.session.userId, req.body);
    return res.status(200).json({ project });
  } catch (error) {
    console.error("[projects] updateCurrentProject failed:", error.message);
    return res.status(500).json({ message: "Failed to save project" });
  }
}

module.exports = {
  getCurrentProject,
  updateCurrentProject,
};
