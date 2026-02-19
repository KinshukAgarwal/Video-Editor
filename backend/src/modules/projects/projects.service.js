const Project = require("./projects.model");

function sanitizeProject(projectDoc) {
  return {
    id: projectDoc._id.toString(),
    name: projectDoc.name,
    mediaItems: Array.isArray(projectDoc.mediaItems) ? projectDoc.mediaItems : [],
    timelineClips: Array.isArray(projectDoc.timelineClips) ? projectDoc.timelineClips : [],
    updatedAt: projectDoc.updatedAt,
  };
}

async function getOrCreateCurrentProject(userId) {
  let project = await Project.findOne({ userId });
  if (!project) {
    project = await Project.create({
      userId,
      name: "Default Project",
      mediaItems: [],
      timelineClips: [],
    });
  }

  return sanitizeProject(project);
}

async function saveCurrentProject(userId, payload) {
  const mediaItems = Array.isArray(payload.mediaItems) ? payload.mediaItems : [];
  const timelineClips = Array.isArray(payload.timelineClips) ? payload.timelineClips : [];

  const project = await Project.findOneAndUpdate(
    { userId },
    {
      $set: {
        mediaItems,
        timelineClips,
      },
      $setOnInsert: {
        name: "Default Project",
      },
    },
    { new: true, upsert: true }
  );

  return sanitizeProject(project);
}

module.exports = {
  getOrCreateCurrentProject,
  saveCurrentProject,
};
