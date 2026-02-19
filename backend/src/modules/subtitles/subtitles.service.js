const fs = require("fs");
const path = require("path");
const http = require("http");
const FormData = require("form-data");

const PYTHON_SERVICE_URL =
    process.env.PYTHON_SERVICE_URL || "http://localhost:5001";

function generateSubtitles(filePath) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(filePath)) {
            return resolve({ error: "Media file not found on server", status: 404 });
        }

        const form = new FormData();
        form.append("file", fs.createReadStream(filePath), path.basename(filePath));

        const url = new URL("/transcribe", PYTHON_SERVICE_URL);

        const req = http.request(
            {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname,
                method: "POST",
                headers: form.getHeaders(),
            },
            (res) => {
                let body = "";
                res.on("data", (chunk) => {
                    body += chunk;
                });
                res.on("end", () => {
                    try {
                        const data = JSON.parse(body);
                        if (res.statusCode >= 400) {
                            return resolve({
                                error:
                                    data.error || "Transcription service returned an error",
                                status: res.statusCode,
                            });
                        }
                        resolve({
                            clips: data.clips || [],
                            segmentCount: data.segmentCount || 0,
                        });
                    } catch (parseErr) {
                        resolve({
                            error: "Failed to parse transcription response",
                            status: 500,
                        });
                    }
                });
            }
        );

        req.on("error", (err) => {
            resolve({
                error: `Cannot reach Python service: ${err.message}`,
                status: 502,
            });
        });

        form.pipe(req);
    });
}

module.exports = { generateSubtitles };
