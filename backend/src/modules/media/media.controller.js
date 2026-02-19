const { uploadMedia } = require("./media.service");

async function upload(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded" });
        }

        const media = await uploadMedia(req.session.userId, req.file);
        return res.status(201).json({ media });
    } catch (error) {
        console.error("[media] upload failed:", error.message);
        return res.status(500).json({ message: "File upload failed" });
    }
}

module.exports = { upload };
