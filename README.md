# YouTranscribe • Full-Length YouTube Video to Text Transcriber

YouTranscribe is a web application designed to take any YouTube video link and transcribe the video into text for its **entire duration** (from 0:00 to the very end). It provides instant, timestamped, continuous, and exportable transcripts with interactive playback seeking.

---

## 🌟 Key Features

* **Full-Length Transcription**:
  * Transcribes 100% of the video duration, from 1-minute shorts to 2+ hour lectures and podcasts.
  * Direct extraction engine that fetches full transcripts in 1–3 seconds without downloading massive video files.
* **Universal Link Compatibility**:
  * Supports `https://www.youtube.com/watch?v=...`
  * Supports short URLs `https://youtu.be/...`
  * Supports YouTube Shorts `https://www.youtube.com/shorts/...`
  * Supports mobile links `https://m.youtube.com/...`
  * Supports bare 11-character video IDs.
* **Interactive Player & Click-to-Seek**:
  * Click any timestamp `[00:04:12]` to seek the embedded YouTube video directly to that exact second.
* **Multi-View Workspace**:
  * **Interactive Timestamps**: Readable conversational paragraphs paired with time badges and individual paragraph copying.
  * **Continuous Clean Text**: Flowing, formatted text ready to feed into AI models (ChatGPT, Claude, Gemini, LLMs) or copy for lecture notes.
  * **AI Highlights & Summary**: Automatic extraction of video overview and timeline milestones.
* **In-Transcript Keyword Search**:
  * Real-time search highlighting with instant match count and navigation.
* **Rich Export Formats**:
  * 📋 **Copy to Clipboard**: Clean text or timestamped format.
  * 📄 **Download .TXT**: Plain text transcript with video metadata.
  * ⏱️ **Download .SRT**: Standard SubRip Subtitle file.
  * 🌐 **Download .VTT**: WebVTT file for web media players.
  * 📑 **Download .JSON**: Structured JSON with exact milliseconds and durations.
* **Local History**:
  * Saves recently transcribed videos in browser storage for instant re-access without re-fetching.

---

## 🏗️ Architecture

```
d:\Gen AI\transcribe/
├── server.js              # Express backend API with multi-strategy YouTube caption extractor
├── package.json           # Dependencies and scripts
├── public/                # Web frontend
│   ├── index.html         # Modern responsive UI with Tailwind CSS & Lucide icons
│   ├── app.js             # Client application logic (search, tabs, export, player sync, history)
│   ├── style.css          # Custom styling, animations, and search highlights
│   └── favicon.svg        # Brand icon
└── README.md              # Project documentation
```

---

## 🚀 Quick Start

### 1. Start the Server
```bash
cd "d:\Gen AI\transcribe"
npm start
```

### 2. Open in Browser
Visit **`http://localhost:3002`** in any web browser.

---

## 📡 API Reference

### `POST /api/transcribe`
Transcribes a YouTube video into full-length structured segments and text.

**Request Body:**
```json
{
  "url": "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  "lang": "en"
}
```

**Response:**
```json
{
  "success": true,
  "videoId": "jNQXAC9IVRw",
  "metadata": {
    "title": "Me at the zoo",
    "author": "jawed",
    "duration": "0:19",
    "thumbnailUrl": "https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg"
  },
  "stats": {
    "totalWords": 58,
    "totalCharacters": 298,
    "totalSegments": 6,
    "totalParagraphs": 1,
    "readingTimeMinutes": 1,
    "duration": "0:19",
    "language": "en"
  },
  "paragraphs": [
    {
      "timestamp": "0:01",
      "startMs": 1200,
      "text": "All right, so here we are, in front of the elephants..."
    }
  ],
  "fullText": "All right, so here we are, in front of the elephants the cool thing about these guys is that they have really really really long trunks..."
}
```

---

## 📄 License
MIT License. Free to use and distribute.

