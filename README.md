# YouTranscribe • Full-Length YouTube Video to Text Transcriber

YouTranscribe is a web application designed to take any YouTube video link and transcribe the video into text for its **entire duration** (from 0:00 to the very end). It provides instant, timestamped, continuous, exportable transcripts with interactive playback seeking, automatic file logging, and Hinglish-to-English script conversion.

---

## 🌟 Key Features

* **Full-Length Transcription**:
  * Transcribes 100% of the video duration, from 1-minute shorts to 2+ hour lectures, podcasts, and interviews.
  * Direct InnerTube Android Gateway engine that fetches full transcripts in 1–3 seconds without downloading video/audio files.
* **Smart Language Selection & Hinglish-to-English Converter**:
  * **Language Selector**: Choose between `Auto (Keep Spoken Language)`, `English (Keep English Script)`, `Hindi`, `Spanish`, `French`, or `German`.
  * **Hinglish-to-English Script Converter**: Solves YouTube India's ASR issue where English speech in Indian podcasts/interviews is forced into Devanagari Hindi phonetics (`यू नो आई वास वाचिंग...`). Automatically converts Devanagari phonemes into readable Latin English script as spoken.
  * **1-Click Script Switcher**: Easily toggle between English script and original Devanagari script directly in the web UI.
* **Automatic File Logging & Versioning in `content/`**:
  * Every completed transcript is automatically saved to [`content/<Video Title>.txt`](file:///d:/Gen%20AI/transcribe/content/).
  * **Content Identity Check**: If a file already exists for that video title, the system verifies whether the content is identical.
    * **If identical**: Reuses the existing file (prevents duplicate clutter) and shows verification in the UI.
    * **If content differs**: Automatically creates a new file with an incremental numeric suffix (e.g. `Title (1).txt`).
* **Sentence & Speaker Line Breaking**:
  * **Sentence Breaks**: Full continuous text cleanly breaks onto a new line after every terminal punctuation mark (`.`, `?`, `!`, `।`).
  * **Smart Protection**: Protects abbreviations (`Dr.`, `Mr.`, `Mrs.`, `vs.`, `U.S.`, `etc.`), initials, and decimals (`24.0`, `$3.50`) from false splits.
  * **Speaker Separation**: Automatically detects speaker changes (`SPEAKER:`, `SPEAKER 1:`, `>>`, `[Host]:`) and formats distinct speaker sections.
* **Interactive Player & Click-to-Seek**:
  * Click any timestamp `[00:04:12]` to seek the embedded YouTube video directly to that exact second.
* **Multi-View Workspace**:
  * **Interactive Timestamps**: Readable conversational paragraphs paired with time badges and individual paragraph copying.
  * **Continuous Clean Text**: Flowing, formatted text with sentence line breaks ready for AI models (ChatGPT, Claude, Gemini, LLMs) or notes.
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
├── server.js              # Express backend with InnerTube extractor, proxy support & content logger
├── package.json           # Dependencies and scripts (localtunnel, undici, sanscript)
├── render.yaml            # Render Blueprint deployment configuration
├── start-tunnel.bat       # 1-click Windows launcher for local server + public HTTPS tunnel
├── content/               # Auto-logged video transcripts (<Video Title>.txt)
│   ├── .gitkeep
│   └── <Video Title>.txt
├── public/                # Web frontend
│   ├── index.html         # Responsive UI with Tailwind CSS, Lucide icons & language selector
│   ├── app.js             # Client logic (search, tabs, export, player sync, script switcher)
│   ├── style.css          # Custom styling, animations, and search highlights
│   └── favicon.svg        # Brand icon
└── README.md              # Project documentation
```

---

## 🚀 Quick Start

### 1. Start the Local Server
```bash
cd "d:\Gen AI\transcribe"
npm start
```
Visit **`http://localhost:3002`** in any web browser.

### 2. Start Local Server with Public HTTPS Tunnel (1-Click)
Run your local server through a secure public HTTPS tunnel using your residential IP (bypasses all YouTube datacenter blocks):
```bash
npm run tunnel
```
*Or on Windows, simply double-click [`start-tunnel.bat`](file:///d:/Gen%20AI/transcribe/start-tunnel.bat).*

---

## 📡 API Reference

### 1. `POST /api/transcribe`
Transcribes a YouTube video into full-length structured segments, paragraphs, and formatted continuous text.

**Request Body:**
```json
{
  "url": "https://www.youtube.com/watch?v=UF8uR6Z6KLc",
  "lang": "auto"
}
```
*`lang` can be `"auto"`, `"en"`, `"hi"`, `"es"`, `"fr"`, or `"de"`.*

**Response:**
```json
{
  "success": true,
  "videoId": "UF8uR6Z6KLc",
  "metadata": {
    "title": "Steve Jobs' 2005 Stanford Commencement Address",
    "author": "Stanford",
    "duration": "15:04",
    "thumbnailUrl": "https://i.ytimg.com/vi/UF8uR6Z6KLc/hqdefault.jpg"
  },
  "stats": {
    "totalWords": 2314,
    "totalCharacters": 11820,
    "totalSegments": 182,
    "totalParagraphs": 25,
    "readingTimeMinutes": 12,
    "duration": "15:04",
    "language": "English"
  },
  "hasDevanagari": false,
  "loggedFile": {
    "filename": "Steve Jobs 2005 Stanford Commencement Address.txt",
    "relativePath": "content/Steve Jobs 2005 Stanford Commencement Address.txt",
    "status": "created",
    "isSameContent": false,
    "message": "Saved transcript to content/Steve Jobs 2005 Stanford Commencement Address.txt"
  },
  "paragraphs": [
    {
      "timestamp": "0:00",
      "startMs": 0,
      "text": "I am honored to be with you today at your commencement..."
    }
  ],
  "fullText": "I am honored to be with you today at your commencement from one of the finest universities in the world.\nI never graduated from college.\nTruth be told, this is the closest I've ever gotten to a college graduation.\n..."
}
```

---

### 2. `GET /api/content`
Lists all saved transcript files in the [`content/`](file:///d:/Gen%20AI/transcribe/content/) folder.

**Response:**
```json
{
  "success": true,
  "count": 2,
  "files": [
    {
      "filename": "Best Short Motivational Speech Video - 24 HOURS.txt",
      "relativePath": "content/Best Short Motivational Speech Video - 24 HOURS.txt",
      "sizeBytes": 3245,
      "modifiedAt": "2026-10-24T09:38:00.000Z"
    }
  ]
}
```

---

### 3. `GET /api/content/file?name=<filename>`
Returns the raw text content of any saved transcript file.

---

## 🌐 Deployment & Remote Access (Bypassing YouTube Datacenter Blocks)

YouTube blocks automated requests originating from cloud hosting providers (AWS, Render, GCP, Azure) while allowing requests from residential IPs. You have two rock-solid options:

### 🌟 Option 1: Instant Public URL with Tunnel (Zero Setup, 100% Free)
Run your local server through a secure public HTTPS tunnel using your home/office residential IP.

1. Start your local server and tunnel in one command:
   ```bash
   npm run tunnel
   ```
   *Or on Windows, simply double-click [`start-tunnel.bat`](file:///d:/Gen%20AI/transcribe/start-tunnel.bat).*
2. Copy the generated public URL (e.g. `https://cool-panda-42.loca.lt`) and open it on your phone or share it with anyone!
3. If prompted with localtunnel's friendly reminder page, click **Click to Continue**.

---

### 🛡️ Option 2: Render Hosting with Residential Proxy
If hosting on Render (`onrender.com`), route YouTube requests through a free residential proxy:

1. Create a free account at [Webshare.io](https://www.webshare.io/) (gives 10 free proxies) or any proxy provider.
2. Go to your **Render Dashboard** $\to$ **YouTranscribe Web Service** $\to$ **Environment**.
3. Add an Environment Variable:
   - **Key**: `HTTPS_PROXY`
   - **Value**: `http://username:password@proxy-host:port`
4. Click **Save Changes**. Render will redeploy automatically and route all YouTube requests through the proxy!

---

## 📄 License
MIT License. Free to use and distribute.
