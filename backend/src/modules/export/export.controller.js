const path = require("path");
const fs = require("fs");
const { startExport, getExportJob } = require("./export.service");
const { getMediaById } = require("../media/media.service");

async function createExport(req, res) {
    try {
        const { timelineClips } = req.body;

        if (!Array.isArray(timelineClips) || timelineClips.length === 0) {
            return res.status(400).json({ message: "timelineClips array is required" });
        }

        // Collect media paths for all clips that have a mediaId
        const mediaPaths = {};
        for (const clip of timelineClips) {
            if (clip.mediaId && !mediaPaths[clip.mediaId]) {
                const media = await getMediaById(clip.mediaId);
                if (media) {
                    mediaPaths[clip.mediaId] = media.storagePath;
                }
            }
        }

        const job = await startExport(req.session.userId, timelineClips, mediaPaths);

        if (job.status === "error") {
            return res.status(400).json({ message: job.error, exportId: job.id });
        }

        return res.status(202).json({
            exportId: job.id,
            status: job.status,
            progress: job.progress,
        });
    } catch (error) {
        console.error("[export] createExport failed:", error.message);
        return res.status(500).json({ message: "Export failed to start" });
    }
}

function getStatus(req, res) {
    const { exportId } = req.params;
    const job = getExportJob(exportId);

    if (!job) {
        return res.status(404).json({ message: "Export job not found" });
    }

    return res.status(200).json({
        exportId: job.id,
        status: job.status,
        progress: job.progress,
        error: job.error,
    });
}

function downloadExport(req, res) {
    const { exportId } = req.params;
    const job = getExportJob(exportId);

    if (!job) {
        return res.status(404).json({ message: "Export job not found" });
    }

    if (job.status !== "done") {
        return res.status(400).json({ message: "Export not yet complete" });
    }

    if (!fs.existsSync(job.outputPath)) {
        return res.status(404).json({ message: "Export file not found" });
    }

    const filename = `export-${exportId}.mp4`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "video/mp4");

    const stream = fs.createReadStream(job.outputPath);
    stream.pipe(res);
}

module.exports = {
    createExport,
    getStatus,
    downloadExport,
};
