import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import "./App.css";
import Input from "./shared/components/input";
import Btn from "./shared/components/btn";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";
const PX_PER_SECOND = 90;
const SNAP_THRESHOLD_PX = 10;
const MIN_CLIP_DURATION = 0.2;
const BASE_TIMELINE_DURATION = 30;
const RULER_HEIGHT = 34;
const TRACK_ROW_HEIGHT = 72;

const TRACKS = [
  {
    id: "visual",
    label: "Visual",
    accepts: ["video", "image"],
  },
  {
    id: "audio",
    label: "Audio",
    accepts: ["audio"],
  },
  {
    id: "subtitle",
    label: "Subtitle",
    accepts: ["subtitle"],
  },
];

const MEDIA_TYPE_RULES = {
  video: {
    label: "Video",
    extensions: [".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"],
    mimePrefixes: ["video/"],
  },
  image: {
    label: "Image",
    extensions: [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg"],
    mimePrefixes: ["image/"],
  },
  audio: {
    label: "Audio",
    extensions: [".mp3", ".wav", ".aac", ".m4a", ".flac", ".ogg", ".opus"],
    mimePrefixes: ["audio/"],
  },
  subtitle: {
    label: "Subtitle",
    extensions: [".srt", ".vtt", ".ass", ".ssa", ".sub", ".sbv"],
    mimeExact: ["text/vtt", "application/x-subrip"],
  },
};

const ACCEPTED_IMPORTS = Object.values(MEDIA_TYPE_RULES)
  .flatMap((type) => type.extensions)
  .join(",");

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));
const roundTime = (value) => Math.round(value * 1000) / 1000;

const stripFileExtension = (fileName) => {
  const index = fileName.lastIndexOf(".");
  if (index < 0) return fileName;
  return fileName.slice(0, index);
};

const getFileExtension = (fileName) => {
  const index = fileName.lastIndexOf(".");
  if (index < 0) return "";
  return fileName.slice(index).toLowerCase();
};

const resolveMediaType = (file) => {
  const extension = getFileExtension(file.name);
  const mimeType = String(file.type || "").toLowerCase();

  for (const [typeKey, rules] of Object.entries(MEDIA_TYPE_RULES)) {
    if (rules.extensions.includes(extension)) {
      return typeKey;
    }

    if (rules.mimeExact?.includes(mimeType)) {
      return typeKey;
    }

    if (rules.mimePrefixes?.some((prefix) => mimeType.startsWith(prefix))) {
      return typeKey;
    }
  }

  return null;
};

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** power;
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[power]}`;
};

const formatTimelineTime = (timeInSeconds) => {
  const safe = Math.max(0, Number(timeInSeconds) || 0);
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  const millis = Math.floor((safe % 1) * 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${millis}`;
};

const createMediaKey = (file) => `${file.name}:${file.size}:${file.lastModified}`;

const getDefaultDurationForType = (mediaType) => {
  if (mediaType === "image") return 5;
  if (mediaType === "subtitle") return 4;
  return 8;
};

const getDefaultClipDuration = (mediaItem) => {
  const fallback = getDefaultDurationForType(mediaItem.type);
  const candidate =
    typeof mediaItem.durationSeconds === "number" && Number.isFinite(mediaItem.durationSeconds)
      ? mediaItem.durationSeconds
      : fallback;
  return roundTime(clampNumber(candidate, MIN_CLIP_DURATION, 60 * 60));
};

const extractMediaDurationFromFile = (file, mediaType) =>
  new Promise((resolve) => {
    if (mediaType !== "video" && mediaType !== "audio") {
      resolve(getDefaultDurationForType(mediaType));
      return;
    }

    const mediaElement = document.createElement(mediaType === "video" ? "video" : "audio");
    const objectUrl = URL.createObjectURL(file);
    let resolved = false;

    const cleanup = () => {
      mediaElement.removeAttribute("src");
      URL.revokeObjectURL(objectUrl);
    };

    const finish = (duration) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(
        roundTime(
          Number.isFinite(duration) && duration > 0
            ? duration
            : getDefaultDurationForType(mediaType)
        )
      );
    };

    mediaElement.preload = "metadata";
    mediaElement.onloadedmetadata = () => finish(mediaElement.duration);
    mediaElement.onerror = () => finish(getDefaultDurationForType(mediaType));
    mediaElement.src = objectUrl;
  });

const hasOverlapInTrack = ({ clips, trackId, start, duration, excludeClipId = null }) => {
  const end = start + duration;
  return clips.some((clip) => {
    if (clip.track !== trackId) return false;
    if (clip.id === excludeClipId) return false;

    const clipEnd = clip.start + clip.duration;
    return start < clipEnd && end > clip.start;
  });
};

const getSnapCandidate = ({
  mode,
  start,
  duration,
  trackId,
  excludeClipId,
  clips,
  playheadTime,
}) => {
  const thresholdTime = SNAP_THRESHOLD_PX / PX_PER_SECOND;
  const snapPoints = [0, playheadTime];

  clips.forEach((clip) => {
    if (clip.id === excludeClipId) return;
    if (clip.track !== trackId) return;
    snapPoints.push(clip.start, clip.start + clip.duration);
  });

  let bestDelta = Number.POSITIVE_INFINITY;
  let snapTime = null;
  let nextStart = start;
  let nextDuration = duration;

  if (mode === "move") {
    const end = start + duration;

    snapPoints.forEach((point) => {
      const startDelta = point - start;
      if (Math.abs(startDelta) <= thresholdTime && Math.abs(startDelta) < Math.abs(bestDelta)) {
        bestDelta = startDelta;
        snapTime = point;
      }

      const endDelta = point - end;
      if (Math.abs(endDelta) <= thresholdTime && Math.abs(endDelta) < Math.abs(bestDelta)) {
        bestDelta = endDelta;
        snapTime = point;
      }
    });

    if (Number.isFinite(bestDelta)) {
      nextStart = roundTime(start + bestDelta);
    }
  }

  if (mode === "resize-start") {
    snapPoints.forEach((point) => {
      const delta = point - start;
      if (Math.abs(delta) <= thresholdTime && Math.abs(delta) < Math.abs(bestDelta)) {
        bestDelta = delta;
        snapTime = point;
      }
    });

    if (Number.isFinite(bestDelta)) {
      nextStart = roundTime(start + bestDelta);
    }
  }

  if (mode === "resize-end") {
    const end = start + duration;

    snapPoints.forEach((point) => {
      const delta = point - end;
      if (Math.abs(delta) <= thresholdTime && Math.abs(delta) < Math.abs(bestDelta)) {
        bestDelta = delta;
        snapTime = point;
      }
    });

    if (Number.isFinite(bestDelta)) {
      const snappedEnd = roundTime(end + bestDelta);
      nextDuration = roundTime(snappedEnd - start);
    }
  }

  return {
    start: nextStart,
    duration: nextDuration,
    snapTime,
  };
};

function App() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [authFeedback, setAuthFeedback] = useState({ message: "", field: "" });

  const [mediaItems, setMediaItems] = useState([]);
  const [mediaFeedback, setMediaFeedback] = useState("");
  const [isDragActive, setIsDragActive] = useState(false);

  const [timelineClips, setTimelineClips] = useState([]);
  const [selectedClipId, setSelectedClipId] = useState(null);
  const [playheadTime, setPlayheadTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timelineFeedback, setTimelineFeedback] = useState("");
  const [timelineDropTrack, setTimelineDropTrack] = useState("");
  const [snapGuideTime, setSnapGuideTime] = useState(null);
  const [dragAction, setDragAction] = useState(null);
  const [isProjectLoading, setIsProjectLoading] = useState(false);
  const [projectSaveState, setProjectSaveState] = useState("idle");
  const [subtitleGenState, setSubtitleGenState] = useState("idle");
  const [exportState, setExportState] = useState({ status: "idle", progress: 0, downloadUrl: null });

  const fileInputRef = useRef(null);
  const previewVideoRef = useRef(null);
  const previewAudioRef = useRef(null);
  const mediaObjectUrls = useRef({});
  const mediaFiles = useRef({});
  const timelineViewportRef = useRef(null);
  const timelineClipsRef = useRef([]);
  const hasLoadedProjectRef = useRef(false);
  const saveTimeoutRef = useRef(null);

  useEffect(() => {
    timelineClipsRef.current = timelineClips;
  }, [timelineClips]);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/auth/me`, {
          withCredentials: true,
        });
        setCurrentUser(response.data.user);
      } catch (_error) {
        setCurrentUser(null);
      } finally {
        setIsCheckingSession(false);
      }
    };

    checkSession();
  }, []);

  useEffect(() => {
    if (!currentUser) {
      hasLoadedProjectRef.current = false;
      setProjectSaveState("idle");
      return;
    }

    let cancelled = false;

    const loadProject = async () => {
      setIsProjectLoading(true);
      try {
        const response = await axios.get(`${API_BASE_URL}/api/projects/current`, {
          withCredentials: true,
        });

        if (cancelled) return;
        const project = response.data?.project || {};
        setMediaItems(Array.isArray(project.mediaItems) ? project.mediaItems : []);
        setTimelineClips(Array.isArray(project.timelineClips) ? project.timelineClips : []);
        setSelectedClipId(null);
        setPlayheadTime(0);
        setTimelineFeedback("Project loaded");
        hasLoadedProjectRef.current = true;
        setProjectSaveState("saved");
      } catch (error) {
        if (cancelled) return;
        console.error("[projects] load failed:", error?.response?.data?.message || error.message);
        setTimelineFeedback("Failed to load project data");
        hasLoadedProjectRef.current = true;
        setProjectSaveState("error");
      } finally {
        if (!cancelled) {
          setIsProjectLoading(false);
        }
      }
    };

    loadProject();

    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || isProjectLoading || !hasLoadedProjectRef.current) {
      return undefined;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    setProjectSaveState("saving");

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await axios.put(
          `${API_BASE_URL}/api/projects/current`,
          {
            mediaItems,
            timelineClips,
          },
          { withCredentials: true }
        );
        setProjectSaveState("saved");
      } catch (error) {
        console.error("[projects] save failed:", error?.response?.data?.message || error.message);
        setProjectSaveState("error");
      }
    }, 800);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [currentUser, isProjectLoading, mediaItems, timelineClips]);

  const selectedClip = useMemo(
    () => timelineClips.find((clip) => clip.id === selectedClipId) || null,
    [timelineClips, selectedClipId]
  );

  const activeSubtitle = useMemo(() => {
    return (
      timelineClips.find(
        (clip) =>
          clip.track === "subtitle" &&
          playheadTime >= clip.start &&
          playheadTime <= clip.start + clip.duration
      ) || null
    );
  }, [playheadTime, timelineClips]);

  const activeVisualClip = useMemo(() => {
    return (
      timelineClips.find(
        (clip) =>
          clip.track === "visual" &&
          playheadTime >= clip.start &&
          playheadTime < clip.start + clip.duration
      ) || null
    );
  }, [playheadTime, timelineClips]);

  const activeAudioClip = useMemo(() => {
    return (
      timelineClips.find(
        (clip) =>
          clip.track === "audio" &&
          playheadTime >= clip.start &&
          playheadTime < clip.start + clip.duration
      ) || null
    );
  }, [playheadTime, timelineClips]);

  const getObjectUrl = useCallback((mediaId) => {
    return mediaObjectUrls.current[mediaId] || null;
  }, []);

  const timelineDuration = useMemo(() => {
    const clipEnd = timelineClips.reduce(
      (max, clip) => Math.max(max, clip.start + clip.duration),
      0
    );
    return Math.max(BASE_TIMELINE_DURATION, Math.ceil(Math.max(clipEnd + 3, playheadTime + 3)));
  }, [playheadTime, timelineClips]);

  const timelineWidth = Math.max(900, timelineDuration * PX_PER_SECOND);

  const clipsByTrack = useMemo(() => {
    return TRACKS.reduce((acc, track) => {
      acc[track.id] = timelineClips
        .filter((clip) => clip.track === track.id)
        .sort((a, b) => a.start - b.start);
      return acc;
    }, {});
  }, [timelineClips]);

  useEffect(() => {
    if (!isPlaying) return undefined;

    const timer = setInterval(() => {
      setPlayheadTime((prev) => {
        const next = roundTime(prev + 0.05);
        if (next >= timelineDuration) {
          setIsPlaying(false);
          return timelineDuration;
        }
        return next;
      });
    }, 50);

    return () => clearInterval(timer);
  }, [isPlaying, timelineDuration]);

  // Helper: load source into a media element when the active clip changes
  const syncMediaSource = useCallback((el, clip, type) => {
    if (!el) return;
    if (!clip) {
      el.pause();
      if (el.getAttribute("data-media-id")) {
        el.removeAttribute("data-media-id");
        el.removeAttribute("src");
        el.load();
      }
      return;
    }
    const url = getObjectUrl(clip.mediaId);
    if (!url) return;
    if (el.getAttribute("data-media-id") === clip.mediaId) return;

    el.setAttribute("data-media-id", clip.mediaId);
    el.src = url;

    if (type === "video") {
      el.addEventListener("error", () => {
        console.error("[preview] Video load error. On Fedora try: sudo dnf install ffmpeg-libs gstreamer1-plugins-ugly");
      }, { once: true });
    }
  }, [getObjectUrl]);

  // Load video source when the active visual clip changes
  useEffect(() => {
    syncMediaSource(previewVideoRef.current, activeVisualClip, "video");
  }, [activeVisualClip?.mediaId, syncMediaSource]);

  // Load audio source when the active audio clip changes
  useEffect(() => {
    syncMediaSource(previewAudioRef.current, activeAudioClip, "audio");
  }, [activeAudioClip?.mediaId, syncMediaSource]);

  // Playback control — seek only on play/pause transitions and when scrubbing while paused
  const wasPlayingRef = useRef(false);
  useEffect(() => {
    const video = previewVideoRef.current;
    const audio = previewAudioRef.current;
    const playStateChanged = wasPlayingRef.current !== isPlaying;
    wasPlayingRef.current = isPlaying;

    const seekEl = (el, clip) => {
      if (!el || !clip || el.readyState < 1) return;
      el.currentTime = Math.max(0, (clip.sourceIn || 0) + (playheadTime - clip.start));
    };

    if (isPlaying && playStateChanged) {
      // Just started playing — seek to current position and let the browser play naturally
      seekEl(video, activeVisualClip);
      seekEl(audio, activeAudioClip);
      if (video && activeVisualClip) video.play().catch(() => { });
      if (audio && activeAudioClip) audio.play().catch(() => { });
    } else if (!isPlaying && playStateChanged) {
      // Just paused — freeze on current frame
      if (video) video.pause();
      if (audio) audio.pause();
      seekEl(video, activeVisualClip);
      seekEl(audio, activeAudioClip);
    } else if (!isPlaying) {
      // Scrubbing while paused
      seekEl(video, activeVisualClip);
      seekEl(audio, activeAudioClip);
    }
    // During playback (isPlaying && !playStateChanged): do nothing — video plays on its own
  }, [isPlaying, playheadTime, activeVisualClip, activeAudioClip]);

  useEffect(() => {
    if (!selectedClipId) return;
    if (timelineClips.some((clip) => clip.id === selectedClipId)) return;
    setSelectedClipId(null);
  }, [selectedClipId, timelineClips]);

  useEffect(() => {
    setPlayheadTime((prev) => Math.min(prev, timelineDuration));
  }, [timelineDuration]);

  useEffect(() => {
    if (!dragAction) {
      return undefined;
    }

    const handleMouseMove = (event) => {
      const clips = timelineClipsRef.current;
      const targetClip = clips.find((clip) => clip.id === dragAction.clipId);
      if (!targetClip) {
        return;
      }

      const deltaTime = (event.clientX - dragAction.startClientX) / PX_PER_SECOND;
      let nextStart = dragAction.originalStart;
      let nextDuration = dragAction.originalDuration;

      if (dragAction.mode === "move") {
        nextStart = roundTime(clampNumber(dragAction.originalStart + deltaTime, 0, timelineDuration));
      }

      if (dragAction.mode === "resize-start") {
        const clipEnd = dragAction.originalStart + dragAction.originalDuration;
        const maxStart = clipEnd - MIN_CLIP_DURATION;
        nextStart = roundTime(
          clampNumber(dragAction.originalStart + deltaTime, 0, maxStart)
        );
        nextDuration = roundTime(clipEnd - nextStart);
      }

      if (dragAction.mode === "resize-end") {
        const nextEnd = roundTime(
          clampNumber(
            dragAction.originalStart + dragAction.originalDuration + deltaTime,
            dragAction.originalStart + MIN_CLIP_DURATION,
            timelineDuration
          )
        );
        nextDuration = roundTime(nextEnd - dragAction.originalStart);
      }

      const snapped = getSnapCandidate({
        mode: dragAction.mode,
        start: nextStart,
        duration: nextDuration,
        trackId: targetClip.track,
        excludeClipId: targetClip.id,
        clips,
        playheadTime,
      });

      nextStart = snapped.start;
      nextDuration = Math.max(MIN_CLIP_DURATION, snapped.duration);
      setSnapGuideTime(snapped.snapTime);

      const overlap = hasOverlapInTrack({
        clips,
        trackId: targetClip.track,
        start: nextStart,
        duration: nextDuration,
        excludeClipId: targetClip.id,
      });

      if (overlap) {
        return;
      }

      if (
        Math.abs(targetClip.start - nextStart) < 0.0001 &&
        Math.abs(targetClip.duration - nextDuration) < 0.0001
      ) {
        return;
      }

      setTimelineClips((prev) =>
        prev.map((clip) =>
          clip.id === targetClip.id
            ? {
              ...clip,
              start: nextStart,
              duration: nextDuration,
            }
            : clip
        )
      );
    };

    const handleMouseUp = () => {
      setDragAction(null);
      setSnapGuideTime(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragAction, playheadTime, timelineDuration]);

  useEffect(() => {
    if (!currentUser) return undefined;

    const handleKeyDown = (event) => {
      // Don't capture shortcuts when typing in inputs/textareas
      const tag = event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        if (selectedClipId) {
          setTimelineClips((prev) => prev.filter((c) => c.id !== selectedClipId));
          setSelectedClipId(null);
          setTimelineFeedback("Clip deleted");
        }
        return;
      }

      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        setIsPlaying((prev) => !prev);
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        const step = event.shiftKey ? 0.1 : 1;
        setPlayheadTime((prev) => roundTime(Math.max(0, prev - step)));
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        const step = event.shiftKey ? 0.1 : 1;
        setPlayheadTime((prev) => roundTime(Math.min(timelineDuration, prev + step)));
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentUser, selectedClipId, timelineDuration]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setAuthFeedback({ message: "", field: "" });
  };

  const resetForm = () => {
    setForm({
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    });
  };

  const formatAuthError = (message, field) => {
    if (!field) {
      return message || "Authentication failed";
    }

    const prettyField = field.charAt(0).toUpperCase() + field.slice(1);
    return `${prettyField}: ${message}`;
  };

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    setAuthFeedback({ message: "", field: "" });

    if (isSignUp && form.password !== form.confirmPassword) {
      setAuthFeedback({ message: "Passwords do not match", field: "confirmPassword" });
      return;
    }

    try {
      if (isSignUp) {
        const response = await axios.post(
          `${API_BASE_URL}/api/auth/signup`,
          {
            name: form.name,
            email: form.email,
            password: form.password,
          },
          { withCredentials: true }
        );
        setCurrentUser(response.data.user);
      } else {
        const response = await axios.post(
          `${API_BASE_URL}/api/auth/signin`,
          {
            email: form.email,
            password: form.password,
          },
          { withCredentials: true }
        );
        setCurrentUser(response.data.user);
      }

      resetForm();
    } catch (error) {
      const message = error?.response?.data?.message || "Authentication failed";
      const field = error?.response?.data?.field || "";
      const resolvedMessage = error?.response
        ? formatAuthError(message, field)
        : "Cannot reach backend. Make sure backend is running on port 3000.";
      setAuthFeedback({ message: resolvedMessage, field });
      console.error("[auth-ui] request failed:", { field, message });
    }
  };

  const handleLogout = async () => {
    try {
      await axios.post(`${API_BASE_URL}/api/auth/logout`, {}, { withCredentials: true });
    } catch (error) {
      console.error("[auth-ui] logout failed:", error?.response?.data?.message);
    } finally {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      hasLoadedProjectRef.current = false;
      setCurrentUser(null);
      setAuthFeedback({ message: "", field: "" });
      // Clean up all stored files and object URLs on logout
      mediaFiles.current = {};
      Object.values(mediaObjectUrls.current).forEach((url) => URL.revokeObjectURL(url));
      mediaObjectUrls.current = {};
      setMediaItems([]);
      setMediaFeedback("");
      setTimelineClips([]);
      setSelectedClipId(null);
      setPlayheadTime(0);
      setIsPlaying(false);
      setProjectSaveState("idle");
      resetForm();
    }
  };

  const importMediaFiles = async (fileList) => {
    const incomingFiles = Array.from(fileList || []);
    if (!incomingFiles.length) {
      return;
    }

    const existingKeys = new Set(mediaItems.map((item) => item.key));
    const nextMediaItems = [];
    const feedbackMessages = [];

    for (const file of incomingFiles) {
      const mediaType = resolveMediaType(file);
      if (!mediaType) {
        feedbackMessages.push(`${file.name}: unsupported file type`);
        continue;
      }

      const key = createMediaKey(file);
      if (existingKeys.has(key)) {
        feedbackMessages.push(`${file.name}: already imported`);
        continue;
      }

      const durationSeconds = await extractMediaDurationFromFile(file, mediaType);
      existingKeys.add(key);

      const itemId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Store File object and create object URL for playable media
      mediaFiles.current[itemId] = file;
      if (mediaType === "video" || mediaType === "audio" || mediaType === "image") {
        mediaObjectUrls.current[itemId] = URL.createObjectURL(file);
      }

      nextMediaItems.push({
        id: itemId,
        key,
        name: file.name,
        size: file.size,
        type: mediaType,
        durationSeconds,
      });
    }

    if (nextMediaItems.length) {
      setMediaItems((prev) => [...prev, ...nextMediaItems]);
      feedbackMessages.unshift(`${nextMediaItems.length} file(s) imported`);
    }

    if (!nextMediaItems.length && !feedbackMessages.length) {
      return;
    }

    setMediaFeedback(feedbackMessages.join(" | "));
  };

  const handleFileInputChange = async (event) => {
    await importMediaFiles(event.target.files);
    event.target.value = "";
  };

  const handleDrop = async (event) => {
    event.preventDefault();
    setIsDragActive(false);
    await importMediaFiles(event.dataTransfer.files);
  };

  const removeMediaItem = (id) => {
    // Clean up stored file and object URL
    delete mediaFiles.current[id];
    if (mediaObjectUrls.current[id]) {
      URL.revokeObjectURL(mediaObjectUrls.current[id]);
      delete mediaObjectUrls.current[id];
    }
    setMediaItems((prev) => prev.filter((item) => item.id !== id));
    setTimelineClips((prev) => prev.filter((clip) => clip.mediaId !== id));
  };

  const getTimeAtPointer = (event, element) => {
    const viewport = timelineViewportRef.current;
    const scrollLeft = viewport ? viewport.scrollLeft : 0;
    const rect = element.getBoundingClientRect();
    const x = event.clientX - rect.left + scrollLeft;
    return roundTime(clampNumber(x / PX_PER_SECOND, 0, timelineDuration));
  };

  const addClipToTimeline = ({ media, trackId, startTime }) => {
    const duration = getDefaultClipDuration(media);
    const clips = timelineClipsRef.current;

    const snapped = getSnapCandidate({
      mode: "move",
      start: startTime,
      duration,
      trackId,
      excludeClipId: null,
      clips,
      playheadTime,
    });

    const overlap = hasOverlapInTrack({
      clips,
      trackId,
      start: snapped.start,
      duration: snapped.duration,
    });

    if (overlap) {
      setTimelineFeedback("Cannot place clip: overlaps with an existing clip in this track.");
      setSnapGuideTime(snapped.snapTime);
      return;
    }

    const clipId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const clip = {
      id: clipId,
      mediaId: media.id,
      name: media.name,
      type: media.type,
      track: trackId,
      start: snapped.start,
      duration: roundTime(snapped.duration),
      sourceIn: 0,
      sourceOut: roundTime(snapped.duration),
      subtitleText: media.type === "subtitle" ? stripFileExtension(media.name) : "",
    };

    setTimelineClips((prev) => [...prev, clip]);
    setSelectedClipId(clipId);
    setTimelineFeedback(`${media.name} added to ${trackId} track`);
    setSnapGuideTime(snapped.snapTime);
  };

  const handleTrackDrop = (event, trackId) => {
    event.preventDefault();
    setTimelineDropTrack("");

    const mediaId = event.dataTransfer.getData("text/media-id");
    if (!mediaId) {
      return;
    }

    const media = mediaItems.find((item) => item.id === mediaId);
    if (!media) {
      return;
    }

    const track = TRACKS.find((item) => item.id === trackId);
    if (!track || !track.accepts.includes(media.type)) {
      setTimelineFeedback(`Cannot place ${MEDIA_TYPE_RULES[media.type].label} in ${track?.label || "this"} track`);
      return;
    }

    const startTime = getTimeAtPointer(event, event.currentTarget);
    addClipToTimeline({ media, trackId, startTime });
  };

  const startClipInteraction = (event, clip, mode) => {
    event.stopPropagation();
    setSelectedClipId(clip.id);
    setDragAction({
      mode,
      clipId: clip.id,
      startClientX: event.clientX,
      originalStart: clip.start,
      originalDuration: clip.duration,
    });
  };

  const removeSelectedClip = () => {
    if (!selectedClipId) return;
    setTimelineClips((prev) => prev.filter((clip) => clip.id !== selectedClipId));
    setSelectedClipId(null);
    setTimelineFeedback("Selected clip removed");
  };

  const addManualSubtitleClip = () => {
    const start = roundTime(playheadTime);
    const duration = 3;

    const overlap = hasOverlapInTrack({
      clips: timelineClipsRef.current,
      trackId: "subtitle",
      start,
      duration,
    });

    if (overlap) {
      setTimelineFeedback("Cannot add subtitle clip here due to overlap.");
      return;
    }

    const clipId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setTimelineClips((prev) => [
      ...prev,
      {
        id: clipId,
        mediaId: null,
        name: "Manual Subtitle",
        type: "subtitle",
        track: "subtitle",
        start,
        duration,
        sourceIn: 0,
        sourceOut: duration,
        subtitleText: "Type subtitle text",
      },
    ]);
    setSelectedClipId(clipId);
    setTimelineFeedback("Manual subtitle clip added");
  };

  const updateSelectedSubtitleText = (text) => {
    if (!selectedClip || selectedClip.type !== "subtitle") {
      return;
    }

    setTimelineClips((prev) =>
      prev.map((clip) =>
        clip.id === selectedClip.id
          ? {
            ...clip,
            subtitleText: text,
          }
          : clip
      )
    );
  };

  const generateSubtitles = async () => {
    const videoItem = mediaItems.find((item) => item.type === "video");
    if (!videoItem) {
      setTimelineFeedback("Import a video file first to generate subtitles.");
      return;
    }

    // We need the original File object to upload. Check if it's available via the
    // file input or stored reference. Since media items are metadata-only, we need
    // the user to have the file accessible. We'll use a hidden file re-pick if needed,
    // but first try to find the file from the input.
    setSubtitleGenState("uploading");
    setTimelineFeedback("Uploading video for transcription…");

    try {
      // Step 1: Upload the video file to backend
      // We need to re-select the file since we only stored metadata.
      // Create a file picker that auto-filters to the video.
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = MEDIA_TYPE_RULES.video.extensions.join(",");

      const file = await new Promise((resolve, reject) => {
        fileInput.onchange = (e) => {
          const f = e.target.files?.[0];
          if (f) resolve(f);
          else reject(new Error("No file selected"));
        };
        fileInput.addEventListener("cancel", () => reject(new Error("Cancelled")));
        fileInput.click();
      });

      const formData = new FormData();
      formData.append("file", file);

      const uploadRes = await axios.post(`${API_BASE_URL}/api/media/upload`, formData, {
        withCredentials: true,
        headers: { "Content-Type": "multipart/form-data" },
      });

      const mediaId = uploadRes.data.media?.id;
      if (!mediaId) throw new Error("Upload succeeded but no media ID returned");

      // Step 2: Generate subtitles
      setSubtitleGenState("generating");
      setTimelineFeedback("Generating subtitles (this may take a moment)…");

      const genRes = await axios.post(
        `${API_BASE_URL}/api/subtitles/generate`,
        { mediaId },
        { withCredentials: true }
      );

      const clips = genRes.data.clips || [];
      if (clips.length === 0) {
        setTimelineFeedback("No speech detected in the video.");
        setSubtitleGenState("idle");
        return;
      }

      // Step 3: Insert subtitle clips into timeline
      const currentClips = timelineClipsRef.current;
      const newClips = [];
      for (const seg of clips) {
        const overlap = hasOverlapInTrack({
          clips: [...currentClips, ...newClips],
          trackId: "subtitle",
          start: seg.start,
          duration: seg.duration,
        });
        if (overlap) continue;

        newClips.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          mediaId: null,
          name: "Subtitle",
          type: "subtitle",
          track: "subtitle",
          start: seg.start,
          duration: seg.duration,
          sourceIn: 0,
          sourceOut: seg.duration,
          subtitleText: seg.subtitleText,
        });
      }

      setTimelineClips((prev) => [...prev, ...newClips]);
      setTimelineFeedback(`${newClips.length} subtitle clip(s) generated.`);
      setSubtitleGenState("idle");
    } catch (error) {
      if (error.message === "Cancelled" || error.message === "No file selected") {
        setTimelineFeedback("");
        setSubtitleGenState("idle");
        return;
      }
      console.error("[subtitles] generation failed:", error?.response?.data?.message || error.message);
      setTimelineFeedback(
        error?.response?.data?.message || "Subtitle generation failed. Is the Python service running?"
      );
      setSubtitleGenState("idle");
    }
  };

  const exportProject = async () => {
    const clipsWithMedia = timelineClips.filter((c) => c.track === "visual" || c.track === "audio");
    if (clipsWithMedia.length === 0) {
      setTimelineFeedback("Add a video or audio clip to the timeline before exporting.");
      return;
    }

    setExportState({ status: "uploading", progress: 0, downloadUrl: null });
    setTimelineFeedback("Uploading media for export…");

    try {
      // Collect unique mediaIds that need uploading
      const uniqueMediaIds = [...new Set(clipsWithMedia.map((c) => c.mediaId).filter(Boolean))];

      // Upload each source file and map client mediaId → server mediaId
      const mediaIdMap = {};
      for (const clientId of uniqueMediaIds) {
        const file = mediaFiles.current[clientId];
        if (!file) {
          console.warn("[export] No stored file for mediaId:", clientId);
          continue;
        }

        const formData = new FormData();
        formData.append("file", file);

        const uploadRes = await axios.post(`${API_BASE_URL}/api/media/upload`, formData, {
          withCredentials: true,
          headers: { "Content-Type": "multipart/form-data" },
        });

        const serverId = uploadRes.data.media?.id;
        if (!serverId) throw new Error(`Upload failed for ${file.name}`);
        mediaIdMap[clientId] = serverId;
      }

      // Patch timeline clips with server media IDs
      const exportClips = timelineClips.map((clip) => {
        if (clip.mediaId && mediaIdMap[clip.mediaId]) {
          return { ...clip, mediaId: mediaIdMap[clip.mediaId] };
        }
        return clip;
      });

      // Start export
      setExportState({ status: "processing", progress: 0, downloadUrl: null });
      setTimelineFeedback("Exporting video…");

      const exportRes = await axios.post(
        `${API_BASE_URL}/api/export`,
        { timelineClips: exportClips },
        { withCredentials: true }
      );

      const exportId = exportRes.data.exportId;
      if (!exportId) throw new Error("Export failed to start");

      // Poll for progress
      const poll = async () => {
        const statusRes = await axios.get(
          `${API_BASE_URL}/api/export/${exportId}/status`,
          { withCredentials: true }
        );
        const { status, progress, error } = statusRes.data;

        if (status === "done") {
          const downloadUrl = `${API_BASE_URL}/api/export/${exportId}/download`;
          setExportState({ status: "done", progress: 100, downloadUrl });
          setTimelineFeedback("Export complete! Click Download.");
          return;
        }

        if (status === "error") {
          setExportState({ status: "idle", progress: 0, downloadUrl: null });
          setTimelineFeedback(`Export failed: ${error || "Unknown error"}`);
          return;
        }

        setExportState((prev) => ({ ...prev, progress }));
        setTimelineFeedback(`Exporting… ${progress}%`);
        setTimeout(poll, 1000);
      };

      await poll();
    } catch (error) {
      console.error("[export] failed:", error?.response?.data?.message || error.message);
      setTimelineFeedback(error?.response?.data?.message || "Export failed.");
      setExportState({ status: "idle", progress: 0, downloadUrl: null });
    }
  };

  if (isCheckingSession) {
    return <main className="auth-page">Checking session...</main>;
  }

  if (currentUser) {
    return (
      <main className="editor-page">
        <header className="editor-topbar">
          <div>
            <h1 className="editor-topbar-title">Video Editor</h1>
            <p className="editor-topbar-subtitle">
              Signed in as {currentUser.name} ({currentUser.email})
            </p>
            <p className="editor-project-status">
              {isProjectLoading
                ? "Loading project..."
                : projectSaveState === "saving"
                  ? "Saving..."
                  : projectSaveState === "error"
                    ? "Autosave failed"
                    : "All changes saved"}
            </p>
          </div>
          <Btn size="medium" label="Logout" onClick={handleLogout} className="editor-logout-btn" />
        </header>

        <section className="editor-workspace">
          <aside className="media-panel">
            <div className="media-panel-head">
              <h2>Media Imports</h2>
              <p>Import videos, images, audio, and subtitles.</p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_IMPORTS}
              className="hidden-file-input"
              onChange={handleFileInputChange}
            />

            <div
              className={`media-dropzone ${isDragActive ? "is-active" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragActive(true);
              }}
              onDragLeave={() => setIsDragActive(false)}
              onDrop={handleDrop}
            >
              <p>Drag and drop files here</p>
              <Btn size="medium" label="Browse Files" onClick={() => fileInputRef.current?.click()} />
            </div>

            {mediaFeedback && <p className="media-feedback">{mediaFeedback}</p>}

            <div className="media-list">
              {mediaItems.length === 0 ? (
                <p className="media-empty">No media imported yet.</p>
              ) : (
                mediaItems.map((item) => (
                  <div
                    key={item.id}
                    className="media-item"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/media-id", item.id);
                      event.dataTransfer.effectAllowed = "copy";
                    }}
                  >
                    <div>
                      <p className="media-item-name">{item.name}</p>
                      <p className="media-item-meta">
                        {MEDIA_TYPE_RULES[item.type].label} • {formatBytes(item.size)} • {formatTimelineTime(item.durationSeconds || 0)}
                      </p>
                    </div>
                    <button type="button" className="media-remove" onClick={() => removeMediaItem(item.id)}>
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>

            {mediaItems.length > 0 && (
              <button
                type="button"
                className="media-clear"
                onClick={() => {
                  setMediaItems([]);
                  setTimelineClips([]);
                  setSelectedClipId(null);
                  setMediaFeedback("All imported files cleared");
                }}
              >
                Clear All
              </button>
            )}
          </aside>

          <section className="editor-right">
            <section className="editor-preview-frame">
              <div className="preview-head">
                <div>
                  <h3>Output Preview</h3>
                  <p>Current time: {formatTimelineTime(playheadTime)}</p>
                </div>
                <div className="preview-controls">
                  <Btn
                    size="small"
                    label={isPlaying ? "Pause" : "Play"}
                    onClick={() => setIsPlaying((prev) => !prev)}
                  />
                  <Btn size="small" label="Reset" onClick={() => setPlayheadTime(0)} />
                  <Btn
                    size="small"
                    label={
                      exportState.status === "uploading"
                        ? "Uploading…"
                        : exportState.status === "processing"
                          ? `Exporting ${exportState.progress}%`
                          : "Export"
                    }
                    onClick={exportProject}
                    disabled={exportState.status !== "idle" && exportState.status !== "done"}
                  />
                  {exportState.downloadUrl && (
                    <a
                      href={exportState.downloadUrl}
                      className="export-download-link"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Download
                    </a>
                  )}
                </div>
              </div>

              <div className="preview-canvas">
                <video
                  ref={previewVideoRef}
                  className="preview-video"
                  muted={!!activeAudioClip}
                  playsInline
                  style={{ display: activeVisualClip?.type === "video" ? "block" : "none" }}
                />
                {activeVisualClip?.type === "image" && getObjectUrl(activeVisualClip.mediaId) && (
                  <img
                    src={getObjectUrl(activeVisualClip.mediaId)}
                    className="preview-image"
                    alt={activeVisualClip.name || "Preview"}
                  />
                )}
                {!activeVisualClip && (
                  <div className="preview-idle">
                    <p>Add a video or image to the timeline to see the preview.</p>
                  </div>
                )}
                {activeSubtitle && (
                  <div className="preview-subtitle-overlay">
                    {activeSubtitle.subtitleText}
                  </div>
                )}
                <audio ref={previewAudioRef} style={{ display: "none" }} />
              </div>

              {selectedClip?.type === "subtitle" && (
                <div className="subtitle-editor-card">
                  <h4>Subtitle Text Editor</h4>
                  <textarea
                    value={selectedClip.subtitleText || ""}
                    onChange={(event) => updateSelectedSubtitleText(event.target.value)}
                  />
                </div>
              )}
            </section>

            <section className="editor-timeline-frame">
              <div className="timeline-toolbar">
                <h3>Timeline</h3>
                <div className="timeline-toolbar-actions">
                  <Btn size="small" label="Add Subtitle Clip" onClick={addManualSubtitleClip} />
                  <Btn
                    size="small"
                    label={
                      subtitleGenState === "uploading"
                        ? "Uploading…"
                        : subtitleGenState === "generating"
                          ? "Generating…"
                          : "Generate Subtitles"
                    }
                    onClick={generateSubtitles}
                    disabled={subtitleGenState !== "idle"}
                  />
                  <Btn
                    size="small"
                    label="Delete Selected"
                    onClick={removeSelectedClip}
                    disabled={!selectedClip}
                  />
                </div>
              </div>

              {timelineFeedback && <p className="timeline-feedback">{timelineFeedback}</p>}

              <div className="timeline-layout">
                <div className="timeline-track-labels">
                  <div className="timeline-label-spacer" />
                  {TRACKS.map((track) => (
                    <div key={track.id} className="timeline-track-label">
                      {track.label}
                    </div>
                  ))}
                </div>

                <div className="timeline-viewport" ref={timelineViewportRef}>
                  <div className="timeline-canvas" style={{ width: timelineWidth }}>
                    <div
                      className="timeline-ruler"
                      onClick={(event) => {
                        const time = getTimeAtPointer(event, event.currentTarget);
                        setPlayheadTime(time);
                        setIsPlaying(false);
                      }}
                    >
                      {Array.from({ length: Math.ceil(timelineDuration) + 1 }).map((_, second) => (
                        <div
                          key={second}
                          className="timeline-ruler-tick"
                          style={{ left: second * PX_PER_SECOND }}
                        >
                          <span>{formatTimelineTime(second)}</span>
                        </div>
                      ))}
                    </div>

                    <div className="timeline-track-area">
                      {TRACKS.map((track) => (
                        <div
                          key={track.id}
                          className={`timeline-track-row ${timelineDropTrack === track.id ? "is-drop-active" : ""}`}
                          onDragOver={(event) => {
                            event.preventDefault();
                            setTimelineDropTrack(track.id);
                          }}
                          onDragLeave={() => setTimelineDropTrack("")}
                          onDrop={(event) => handleTrackDrop(event, track.id)}
                          onClick={(event) => {
                            const time = getTimeAtPointer(event, event.currentTarget);
                            setPlayheadTime(time);
                            setIsPlaying(false);
                          }}
                        >
                          {clipsByTrack[track.id]?.map((clip) => {
                            const clipLeft = clip.start * PX_PER_SECOND;
                            const clipWidth = Math.max(24, clip.duration * PX_PER_SECOND);

                            return (
                              <div
                                key={clip.id}
                                className={`timeline-clip timeline-clip-${clip.type} ${selectedClipId === clip.id ? "is-selected" : ""
                                  }`}
                                style={{ left: clipLeft, width: clipWidth }}
                                onMouseDown={(event) => startClipInteraction(event, clip, "move")}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedClipId(clip.id);
                                }}
                              >
                                <div
                                  className="timeline-clip-handle left"
                                  onMouseDown={(event) => startClipInteraction(event, clip, "resize-start")}
                                />
                                <span className="timeline-clip-label">{clip.name}</span>
                                <div
                                  className="timeline-clip-handle right"
                                  onMouseDown={(event) => startClipInteraction(event, clip, "resize-end")}
                                />
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>

                    <div
                      className="timeline-playhead"
                      style={{
                        left: playheadTime * PX_PER_SECOND,
                        top: RULER_HEIGHT,
                        height: TRACKS.length * TRACK_ROW_HEIGHT,
                      }}
                    />

                    {snapGuideTime !== null && (
                      <div
                        className="timeline-snap-guide"
                        style={{
                          left: snapGuideTime * PX_PER_SECOND,
                          top: RULER_HEIGHT,
                          height: TRACKS.length * TRACK_ROW_HEIGHT,
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            </section>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-shell">
        <aside className="auth-visual">
          <div className="auth-logo">a.</div>
          <div className="auth-visual-copy">
            Be a Part of
            <br />
            Something <strong>Beautiful</strong>
          </div>
        </aside>

        <section className="auth-card">
          <h1 className="auth-title">{isSignUp ? "Sign up" : "Login"}</h1>
          <p className="auth-subtitle">
            {isSignUp
              ? "Create your account to get started"
              : "Enter your credentials to access your account"}
          </p>

          <form className="auth-form" onSubmit={handleAuthSubmit}>
            {isSignUp && (
              <>
                <label className="auth-label">Full Name</label>
                <Input
                  size="large"
                  name="name"
                  placeholder="Your full name"
                  value={form.name}
                  onChange={handleChange}
                />
              </>
            )}

            <label className="auth-label">Email</label>
            <Input
              size="large"
              name="email"
              placeholder="name@email.com"
              value={form.email}
              onChange={handleChange}
            />

            <label className="auth-label">Password</label>
            <Input
              size="large"
              name="password"
              type="password"
              placeholder="********"
              value={form.password}
              onChange={handleChange}
            />

            {isSignUp && (
              <>
                <label className="auth-label">Confirm Password</label>
                <Input
                  size="large"
                  name="confirmPassword"
                  type="password"
                  placeholder="********"
                  value={form.confirmPassword}
                  onChange={handleChange}
                />
              </>
            )}

            {!isSignUp && (
              <label className="auth-remember">
                <input type="checkbox" />
                <span>Remember me</span>
              </label>
            )}

            <Btn
              size="large"
              type="submit"
              label={isSignUp ? "Create account" : "Login"}
              className="auth-submit"
            />
          </form>

          {authFeedback.message && <p className="auth-error">{authFeedback.message}</p>}

          <div className="auth-divider">
            <span />
            <p>{isSignUp ? "Already have an account?" : "Not a member?"}</p>
            <span />
          </div>

          <button
            type="button"
            className="auth-switch"
            onClick={() => {
              setIsSignUp((value) => !value);
              setAuthFeedback({ message: "", field: "" });
            }}
          >
            {isSignUp ? "Sign in" : "Create an account"}
          </button>
        </section>
      </section>
    </main>
  );
}

export default App;
