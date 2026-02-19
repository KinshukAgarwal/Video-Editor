const path = require("path");
const fs = require("fs");
const Media = require("./media.model");

const UPLOAD_ROOT = path.resolve(__dirname, "../../../../storage/uploads");

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function sanitizeMedia(doc) {
    return {
        id: doc._id.toString(),
        originalName: doc.originalName,
        storagePath: doc.storagePath,
        mediaType: doc.mediaType,
        sizeBytes: doc.sizeBytes,
        durationSeconds: doc.durationSeconds,
        createdAt: doc.createdAt,
    };
}

async function uploadMedia(userId, file) {
    const userDir = path.join(UPLOAD_ROOT, String(userId));
    ensureDir(userDir);

    const uniqueName = `${Date.now()}-${file.originalname}`;
    const destPath = path.join(userDir, uniqueName);

    fs.renameSync(file.path, destPath);

    const doc = await Media.create({
        userId,
        originalName: file.originalname,
        storagePath: destPath,
        mediaType: resolveType(file.originalname),
        sizeBytes: file.size,
        durationSeconds: 0,
    });

    return sanitizeMedia(doc);
}

async function getMediaById(mediaId) {
    const doc = await Media.findById(mediaId);
    if (!doc) return null;
    return sanitizeMedia(doc);
}

function resolveType(filename) {
    const ext = path.extname(filename).toLowerCase();
    const videoExts = [".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"];
    const audioExts = [".mp3", ".wav", ".aac", ".m4a", ".flac", ".ogg", ".opus"];
    const imageExts = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg"];
    const subtitleExts = [".srt", ".vtt", ".ass", ".ssa", ".sub", ".sbv"];

    if (videoExts.includes(ext)) return "video";
    if (audioExts.includes(ext)) return "audio";
    if (imageExts.includes(ext)) return "image";
    if (subtitleExts.includes(ext)) return "subtitle";
    return "video";
}

module.exports = {
    uploadMedia,
    getMediaById,
    UPLOAD_ROOT,
};
