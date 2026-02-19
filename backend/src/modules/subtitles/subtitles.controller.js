const { getMediaById } = require("../media/media.service");
const { generateSubtitles } = require("./subtitles.service");

async function generate(req, res) {
    try {
        const { mediaId } = req.body;

        if (!mediaId) {
            return res.status(400).json({ message: "mediaId is required" });
        }

        const media = await getMediaById(mediaId);
        if (!media) {
            return res.status(404).json({ message: "Media not found" });
        }

        // Only allow transcription of video/audio files
        if (media.mediaType !== "video" && media.mediaType !== "audio") {
            return res
                .status(400)
                .json({ message: "Only video or audio files can be transcribed" });
        }

        console.log(
            `[subtitles] Generating subtitles for "${media.originalName}" (${media.mediaType})`
        );

        const result = await generateSubtitles(media.storagePath);

        if (result.error) {
            return res
                .status(result.status || 500)
                .json({ message: result.error });
        }

        console.log(
            `[subtitles] Generated ${result.segmentCount} subtitle clip(s) for "${media.originalName}"`
        );

        return res.status(200).json({
            clips: result.clips,
            segmentCount: result.segmentCount,
        });
    } catch (error) {
        console.error("[subtitles] generate failed:", error.message);
        return res
            .status(500)
            .json({ message: "Subtitle generation failed. Is the Python service running?" });
    }
}

module.exports = { generate };
