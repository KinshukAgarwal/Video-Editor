const mongoose = require("mongoose");

const projectSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      default: "Default Project",
      trim: true,
    },
    mediaItems: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    timelineClips: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Project", projectSchema);
