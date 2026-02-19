const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

const EXPORT_ROOT = path.resolve(__dirname, "../../../../storage/exports");

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

// In-memory store for export jobs
const exportJobs = new Map();

/**
 * Convert seconds to SRT timestamp format: HH:MM:SS,mmm
 */
function toSrtTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    return (
        String(h).padStart(2, "0") + ":" +
        String(m).padStart(2, "0") + ":" +
        String(s).padStart(2, "0") + "," +
        String(ms).padStart(3, "0")
    );
}

/**
 * Write subtitle clips to a temporary .srt file.
 * Times are shifted relative to the video clip's start on the timeline.
 */
function writeSrtFile(subtitleClips, videoStartOffset) {
    const offset = videoStartOffset || 0;
    let srt = "";

    subtitleClips.forEach((clip, i) => {
        const relStart = Math.max(0, clip.start - offset);
        const relEnd = relStart + clip.duration;
        const text = (clip.subtitleText || "").trim();
        if (!text) return;

        srt += `${i + 1}\n`;
        srt += `${toSrtTime(relStart)} --> ${toSrtTime(relEnd)}\n`;
        srt += `${text}\n\n`;
    });

    const tmpPath = path.join(os.tmpdir(), `subs-${Date.now()}.srt`);
    fs.writeFileSync(tmpPath, srt, "utf8");
    console.log(`[export] Wrote SRT file: ${tmpPath} (${subtitleClips.length} cues)`);
    return tmpPath;
}

/**
 * Build a drawtext filter chain (fallback when subtitles filter is unavailable).
 * These strings are passed via spawn (not shell), so only FFmpeg-level escaping is needed.
 */
function buildDrawtextFilter(subtitleClips, videoStartOffset) {
    if (!subtitleClips.length) return null;
    const offset = videoStartOffset || 0;

    const filters = subtitleClips.map((clip) => {
        const text = (clip.subtitleText || "")
            .replace(/\\/g, "\\\\")       // \ → \\
            .replace(/'/g, "\u2019")      // ' → right single quote (avoids escaping)
            .replace(/:/g, "\\:")         // : → \:
            .replace(/%/g, "%%")          // % → %%
            .replace(/\n/g, " ");         // newlines → space

        const relStart = Math.max(0, clip.start - offset);
        const relEnd = relStart + clip.duration;
        const enable = `between(t\\,${relStart.toFixed(3)}\\,${relEnd.toFixed(3)})`;

        return `drawtext=text='${text}':fontcolor=white:fontsize=24:borderw=2:bordercolor=black:x=(w-tw)/2:y=h-th-40:enable='${enable}'`;
    });

    return filters.join(",");
}

/**
 * Run an FFmpeg process and wire up progress + completion handling.
 * onFail is called with (stderrLog, code) when FFmpeg fails, allowing a retry.
 */
function runFfmpeg(args, job, totalDuration, cleanup, onFail) {
    console.log(`[export] FFmpeg command: ffmpeg ${args.join(" ")}`);

    let stderrLog = "";
    const ffmpeg = spawn("ffmpeg", args);

    ffmpeg.stderr.on("data", (data) => {
        const line = data.toString();
        stderrLog += line;
        const timeMatch = line.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (timeMatch) {
            const currentTime =
                parseFloat(timeMatch[1]) * 3600 +
                parseFloat(timeMatch[2]) * 60 +
                parseFloat(timeMatch[3]);
            job.progress = Math.min(99, Math.round((currentTime / totalDuration) * 100));
        }
    });

    ffmpeg.on("close", (code) => {
        if (cleanup) cleanup();

        if (code === 0) {
            job.status = "done";
            job.progress = 100;
            console.log(`[export] Completed: ${job.outputPath}`);
        } else if (onFail) {
            console.warn(`[export] FFmpeg failed (code ${code}), trying fallback…`);
            console.warn(`[export] stderr: ${stderrLog.slice(-500)}`);
            onFail(stderrLog, code);
        } else {
            job.status = "error";
            job.error = `FFmpeg exited with code ${code}. ${stderrLog.slice(-300)}`;
            console.error(`[export] Failed (code ${code}). stderr:\n${stderrLog.slice(-800)}`);
        }
    });

    ffmpeg.on("error", (err) => {
        if (cleanup) cleanup();
        job.status = "error";
        job.error = `FFmpeg not found or spawn error: ${err.message}`;
        console.error(`[export] Spawn error:`, err.message);
    });
}

async function startExport(userId, timelineClips, mediaPaths) {
    const userDir = path.join(EXPORT_ROOT, String(userId));
    ensureDir(userDir);

    const exportId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const outputPath = path.join(userDir, `${exportId}.mp4`);

    const job = {
        id: exportId,
        status: "processing",
        progress: 0,
        outputPath,
        error: null,
    };
    exportJobs.set(exportId, job);

    const visualClips = timelineClips
        .filter((c) => c.track === "visual")
        .sort((a, b) => a.start - b.start);

    const audioClips = timelineClips
        .filter((c) => c.track === "audio")
        .sort((a, b) => a.start - b.start);

    const subtitleClips = timelineClips
        .filter((c) => c.track === "subtitle")
        .sort((a, b) => a.start - b.start);

    const primaryVisual = visualClips[0];
    const primaryAudio = audioClips[0];

    if (!primaryVisual && !primaryAudio) {
        job.status = "error";
        job.error = "No visual or audio clip on the timeline.";
        return job;
    }

    // --- Determine input file ---
    const inputClip = primaryVisual || primaryAudio;
    const inputPath = mediaPaths[inputClip.mediaId];

    if (!inputPath || !fs.existsSync(inputPath)) {
        job.status = "error";
        job.error = "Source media file not found on server. Upload media first.";
        return job;
    }

    // --- Build FFmpeg args ---
    const args = ["-y"];

    // Input with trim
    const sourceIn = inputClip.sourceIn || 0;
    if (sourceIn > 0) {
        args.push("-ss", String(sourceIn));
    }
    args.push("-i", inputPath);
    if (inputClip.duration) {
        args.push("-t", String(inputClip.duration));
    }

    // Separate audio track (different file)
    let hasSecondAudio = false;
    if (primaryAudio && primaryVisual && primaryAudio.mediaId !== primaryVisual.mediaId) {
        const audioPath = mediaPaths[primaryAudio.mediaId];
        if (audioPath && fs.existsSync(audioPath)) {
            const audioSourceIn = primaryAudio.sourceIn || 0;
            if (audioSourceIn > 0) args.push("-ss", String(audioSourceIn));
            args.push("-i", audioPath);
            if (primaryAudio.duration) args.push("-t", String(primaryAudio.duration));
            hasSecondAudio = true;
        }
    }

    // --- Subtitle burn-in via SRT file + retry chain ---
    const hasSubtitles = subtitleClips.length > 0 && primaryVisual;
    const videoStartOffset = primaryVisual ? primaryVisual.start || 0 : 0;
    const totalDuration = inputClip.duration || 10;

    // Helper to build common input args (reused across retries)
    const buildInputArgs = () => {
        const a = ["-y"];
        if (sourceIn > 0) a.push("-ss", String(sourceIn));
        a.push("-i", inputPath);
        if (inputClip.duration) a.push("-t", String(inputClip.duration));

        if (hasSecondAudio) {
            const audioPath = mediaPaths[primaryAudio.mediaId];
            const audioSourceIn = primaryAudio.sourceIn || 0;
            if (audioSourceIn > 0) a.push("-ss", String(audioSourceIn));
            a.push("-i", audioPath);
            if (primaryAudio.duration) a.push("-t", String(primaryAudio.duration));
            a.push("-map", "0:v:0", "-map", "1:a:0");
        }
        return a;
    };

    // --- Fallback 2: no subtitles, stream copy ---
    const exportWithoutSubs = () => {
        console.log("[export] Fallback: exporting without subtitles (stream copy)");
        const a = buildInputArgs();
        a.push("-c", "copy", "-movflags", "+faststart", outputPath);
        runFfmpeg(a, job, totalDuration, null, null);
    };

    // --- Fallback 1: drawtext filter ---
    const exportWithDrawtext = () => {
        console.log("[export] Fallback: trying drawtext filter");
        const a = buildInputArgs();
        const dtFilter = buildDrawtextFilter(subtitleClips, videoStartOffset);
        if (dtFilter) {
            a.push("-vf", dtFilter);
        }
        a.push("-c:v", "libx264", "-preset", "fast", "-crf", "23");
        a.push("-c:a", "aac", "-b:a", "128k");
        a.push("-movflags", "+faststart", outputPath);
        runFfmpeg(a, job, totalDuration, null, () => exportWithoutSubs());
    };

    if (hasSubtitles) {
        // --- Primary: subtitles filter with SRT file ---
        const srtPath = writeSrtFile(subtitleClips, videoStartOffset);
        const escapedSrtPath = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:");

        args.push("-vf", `subtitles='${escapedSrtPath}'`);
        if (hasSecondAudio) {
            args.push("-map", "0:v:0", "-map", "1:a:0");
        }
        args.push("-c:v", "libx264", "-preset", "fast", "-crf", "23");
        args.push("-c:a", "aac", "-b:a", "128k");
        args.push("-movflags", "+faststart", outputPath);

        const cleanup = () => {
            try { fs.unlinkSync(srtPath); } catch (_) { /* ignore */ }
        };

        runFfmpeg(args, job, totalDuration, cleanup, () => exportWithDrawtext());
    } else {
        // No subtitles — stream copy
        if (hasSecondAudio) {
            args.push("-map", "0:v:0", "-map", "1:a:0");
        }
        args.push("-c", "copy", "-movflags", "+faststart", outputPath);
        runFfmpeg(args, job, totalDuration, null, null);
    }

    return job;
}

function getExportJob(exportId) {
    return exportJobs.get(exportId) || null;
}

module.exports = {
    startExport,
    getExportJob,
    EXPORT_ROOT,
};
