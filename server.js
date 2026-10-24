require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { YoutubeTranscript } = require('youtube-transcript');

// Ensure content directory exists
const CONTENT_DIR = path.join(__dirname, 'content');
if (!fs.existsSync(CONTENT_DIR)) {
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
}

/**
 * Sanitizes a video title into a valid, safe filename across all operating systems.
 */
function sanitizeFilename(title) {
  if (!title) return 'transcript';
  let safe = title
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '') // remove illegal chars
    .replace(/[\s\t\n]+/g, ' ')            // collapse whitespaces
    .trim();
  // Strip trailing periods or spaces (disallowed on Windows)
  safe = safe.replace(/[\.\s]+$/, '');
  if (safe.length > 100) {
    safe = safe.slice(0, 100).trim();
  }
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(safe)) {
    safe = `${safe}_file`;
  }
  return safe || 'transcript';
}

/**
 * Extracts and compares transcript content from an existing file with new transcript.
 */
function isFileContentIdentical(filePath, normalizedNewText, newHash) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const fileContent = fs.readFileSync(filePath, 'utf8');

    // 1. Fast check: match Content-Hash header
    const hashMatch = fileContent.match(/^Content-Hash:\s*([a-f0-9]{64})/im);
    if (hashMatch && hashMatch[1] === newHash) {
      return true;
    }

    // 2. Secondary check: compare continuous text section
    const marker = 'FULL CONTINUOUS TEXT';
    const idx = fileContent.indexOf(marker);
    if (idx !== -1) {
      const textAfterMarker = fileContent
        .slice(idx + marker.length)
        .replace(/^[=\-\s\n\r]+/, '')
        .trim()
        .replace(/\s+/g, ' ');
      if (textAfterMarker === normalizedNewText) {
        return true;
      }
    }

    // 3. Direct check: verify if file contains the normalized text
    return fileContent.includes(normalizedNewText);
  } catch (err) {
    console.warn(`Error reading ${filePath} for content comparison:`, err.message);
    return false;
  }
}

/**
 * Formats full continuous text:
 * - Breaks the line after every full stop (. ? ! ।)
 * - Breaks the line for every speaker transition (SPEAKER:, >>, [Speaker Name]:, etc.)
 * - Protects abbreviations (Dr., Mr., vs., etc.) and decimals ($3.50, 24.0) from false splits
 */
function formatContinuousText(rawText) {
  if (!rawText) return '';

  let text = rawText
    .replace(/(?:\r\n|\r|\n)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const SPEAKER_SPLIT_TOKEN = '___SPEAKER_BREAK___';

  // Match >> or >>> speaker transitions
  text = text.replace(/(?:\s|^)(>{2,3})\s*/g, ` ${SPEAKER_SPLIT_TOKEN}$1 `);

  // Match SPEAKER / SPEAKER 1: / SPEAKER [A-Z]:
  text = text.replace(/(?:\s|^)(SPEAKER(?:\s*\d+|\s+[A-Z])?\s*:)/gi, ` ${SPEAKER_SPLIT_TOKEN}$1`);

  // Match [Speaker Name]: or [Speaker Name]
  text = text.replace(/(?:\s|^)(\[[A-Za-z0-9_\s]{2,30}\]:?)/g, ` ${SPEAKER_SPLIT_TOKEN}$1`);

  const ABBREVIATIONS = new Set([
    'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'vs', 'etc', 'eg', 'ie',
    'us', 'uk', 'usa', 'inc', 'ltd', 'co', 'corp', 'st', 'no', 'vol', 'dept',
    'est', 'approx', 'min', 'sec', 'hr', 'jan', 'feb', 'mar', 'apr', 'jun',
    'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'
  ]);

  const speakerBlocks = text
    .split(SPEAKER_SPLIT_TOKEN)
    .map((b) => b.trim())
    .filter(Boolean);

  const formattedBlocks = speakerBlocks.map((block) => {
    const broken = block.replace(/([.?!।]+)(["'”’)]*)(\s+|$)/g, (match, punct, quote, space, offset, fullStr) => {
      // 1. Skip ellipsis (... or ..)
      if (punct.length > 1 && punct.includes('.')) {
        return match;
      }

      // 2. Skip decimals (e.g. 24.0 or $3.50)
      const prevChars = fullStr.slice(Math.max(0, offset - 15), offset);
      const nextChars = fullStr.slice(offset + match.length, offset + match.length + 15);
      if (/\d$/.test(prevChars) && /^\d/.test(nextChars)) {
        return match;
      }

      // 3. Skip abbreviations (e.g. Dr. or U.S.)
      const wordMatch = prevChars.match(/([a-zA-Z]+)$/);
      if (wordMatch) {
        const lastWord = wordMatch[1].toLowerCase();
        if (ABBREVIATIONS.has(lastWord)) {
          return match;
        }
        if (wordMatch[1].length === 1 && !prevChars.endsWith(' I')) {
          return match;
        }
      }

      // Break line after full stop
      return `${punct}${quote}\n`;
    });

    return broken
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n');
  });

  return formattedBlocks.join('\n\n');
}

/**
 * Logs transcript to the content folder with collision and content identity checking.
 * 
 * Rules:
 * - One file per video named from the video title.
 * - If file exists:
 *   - Check if video content is the same as existing file.
 *   - If same: return existing file info (do not duplicate file).
 *   - If different: create a new file with numeric suffix (Title (1).txt, Title (2).txt, etc.)
 */
function logTranscriptToContent({ videoId, metadata, paragraphs, fullText, trackLanguage, stats }) {
  try {
    if (!fs.existsSync(CONTENT_DIR)) {
      fs.mkdirSync(CONTENT_DIR, { recursive: true });
    }

    const title = metadata?.title || `YouTube Video ${videoId}`;
    const baseName = sanitizeFilename(title);
    const normalizedNewText = fullText.trim().replace(/\s+/g, ' ');
    const newHash = crypto.createHash('sha256').update(normalizedNewText).digest('hex');

    // Prepare standardized file content
    const headerLines = [
      `Title: ${title}`,
      `Video ID: ${videoId}`,
      `Video URL: https://www.youtube.com/watch?v=${videoId}`,
      `Channel: ${metadata?.author || 'Unknown'}`,
      `Duration: ${stats?.duration || metadata?.duration || 'Unknown'}`,
      `Language: ${trackLanguage || 'Original'}`,
      `Total Words: ${stats?.totalWords || 0}`,
      `Transcribed At: ${new Date().toISOString()}`,
      `Content-Hash: ${newHash}`,
      '',
      '='.repeat(80),
      'TIMESTAMPED PARAGRAPHS',
      '='.repeat(80),
      '',
    ];

    const timestampLines = (paragraphs || []).map(
      (p) => `[${p.timestamp || '0:00'}] ${p.text}`
    );

    const formattedContinuousText = formatContinuousText(fullText);
    const fullTextSection = [
      '',
      '='.repeat(80),
      'FULL CONTINUOUS TEXT',
      '='.repeat(80),
      '',
      formattedContinuousText,
      '',
    ];

    const fileContent = [...headerLines, ...timestampLines, ...fullTextSection].join('\n');

    const baseFileName = `${baseName}.txt`;
    const baseFilePath = path.join(CONTENT_DIR, baseFileName);

    // Case 1: Base file does NOT exist yet -> Create it
    if (!fs.existsSync(baseFilePath)) {
      fs.writeFileSync(baseFilePath, fileContent, 'utf8');
      console.log(`[Content Log] Created new transcript file: content/${baseFileName}`);
      return {
        filename: baseFileName,
        relativePath: `content/${baseFileName}`,
        status: 'created',
        isSameContent: false,
        message: `Saved transcript to content/${baseFileName}`,
      };
    }

    // Case 2: Base file exists -> Check if content is identical
    if (isFileContentIdentical(baseFilePath, normalizedNewText, newHash)) {
      console.log(`[Content Log] Identical content found in content/${baseFileName}. Showing existing file.`);
      return {
        filename: baseFileName,
        relativePath: `content/${baseFileName}`,
        status: 'identical',
        isSameContent: true,
        message: `Content is identical to existing file content/${baseFileName}. Reused existing file.`,
      };
    }

    // Case 3: Base file exists but content differed -> Look for or create numbered version (1), (2), ...
    let counter = 1;
    let candidateFileName = `${baseName} (${counter}).txt`;
    let candidateFilePath = path.join(CONTENT_DIR, candidateFileName);

    while (fs.existsSync(candidateFilePath)) {
      if (isFileContentIdentical(candidateFilePath, normalizedNewText, newHash)) {
        console.log(`[Content Log] Identical content found in content/${candidateFileName}. Showing existing file.`);
        return {
          filename: candidateFileName,
          relativePath: `content/${candidateFileName}`,
          status: 'identical',
          isSameContent: true,
          message: `Content is identical to existing file content/${candidateFileName}. Reused existing file.`,
        };
      }
      counter++;
      candidateFileName = `${baseName} (${counter}).txt`;
      candidateFilePath = path.join(CONTENT_DIR, candidateFileName);
    }

    // Write new numbered version
    fs.writeFileSync(candidateFilePath, fileContent, 'utf8');
    console.log(`[Content Log] Content differed. Created new version: content/${candidateFileName}`);
    return {
      filename: candidateFileName,
      relativePath: `content/${candidateFileName}`,
      status: 'created_version',
      versionNumber: counter,
      isSameContent: false,
      message: `Content differed from original. Saved new version as content/${candidateFileName}`,
    };
  } catch (logErr) {
    console.error('[Content Log] Error logging transcript file:', logErr);
    return {
      filename: null,
      status: 'error',
      isSameContent: false,
      message: `Failed to save file: ${logErr.message}`,
    };
  }
}

// ============================================================================
// Option 2: Proxy Support for Cloud Deployments (Render / AWS / Heroku)
// Routes all outgoing fetch requests through a residential proxy to bypass
// YouTube cloud datacenter IP blocks.
// ============================================================================
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.PROXY_URL;
if (proxyUrl) {
  try {
    const { ProxyAgent, setGlobalDispatcher } = require('undici');
    const proxyAgent = new ProxyAgent(proxyUrl);
    setGlobalDispatcher(proxyAgent);
    const sanitized = proxyUrl.replace(/:[^:@]+@/, ':****@');
    console.log(`[Proxy] Global fetch dispatcher active via: ${sanitized}`);
  } catch (err) {
    console.error('[Proxy] Failed to configure proxy agent:', err.message);
  }
}

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const LANGUAGE_NAMES = {
  en: 'English',
  hi: 'Hindi',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ar: 'Arabic',
  bn: 'Bengali',
  mr: 'Marathi',
  te: 'Telugu',
  ta: 'Tamil',
  gu: 'Gujarati',
  ur: 'Urdu',
  kn: 'Kannada',
  ml: 'Malayalam',
  pa: 'Punjabi',
};

function getLanguageName(code) {
  if (!code) return 'Original Language';
  const clean = code.toLowerCase().split('-')[0];
  return LANGUAGE_NAMES[clean] || code;
}

/**
 * Extracts 11-character YouTube video ID from various URL formats
 */
function extractVideoId(urlOrId) {
  if (!urlOrId) return null;
  const trimmed = urlOrId.trim();

  // If already an 11-char ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  // Regex for full, short, embed, and shorts URLs
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([^"&?\/\s]{11})/i;
  const match = trimmed.match(regex);
  return match ? match[1] : null;
}

/**
 * Fetches video metadata via YouTube oEmbed API (no API key needed)
 */
async function fetchVideoMetadata(videoId) {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const response = await fetch(oembedUrl);
    if (!response.ok) {
      throw new Error(`oEmbed failed with status ${response.status}`);
    }
    const data = await response.json();
    return {
      title: data.title || 'YouTube Video',
      author: data.author_name || 'YouTube Channel',
      authorUrl: data.author_url || '',
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      maxresThumbnailUrl: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
      embedHtml: data.html || '',
    };
  } catch (err) {
    console.warn(`Could not fetch oEmbed for ${videoId}:`, err.message);
    return {
      title: `YouTube Video (${videoId})`,
      author: 'YouTube Channel',
      authorUrl: '',
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      maxresThumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      embedHtml: '',
    };
  }
}

/**
 * Robust Multi-Strategy YouTube Caption Extractor
 * Primary: Official Android InnerTube Gateway (bypasses data-center IP blocks on Render/AWS)
 * Fallback: Web page HTML scraper
 */
async function fetchDirectCaptionTracks(videoId, requestedLang) {
  let captionTracks = null;

  // 1. Primary Strategy: Android InnerTube Gateway
  try {
    const resp = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
      },
      body: JSON.stringify({
        context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
        videoId: videoId,
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      captionTracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    }
  } catch (errInnerTube) {
    console.warn(`InnerTube player failed for ${videoId}:`, errInnerTube.message);
  }

  // 2. Secondary Strategy: Web page scraping
  if (!captionTracks || captionTracks.length === 0) {
    try {
      const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const res = await fetch(watchUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      const html = await res.text();
      const playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
      if (playerResponseMatch) {
        const playerResponse = JSON.parse(playerResponseMatch[1]);
        captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      }
    } catch (errWeb) {
      console.warn(`Web scrape failed for ${videoId}:`, errWeb.message);
    }
  }

  if (!captionTracks || captionTracks.length === 0) {
    const isCloudEnv = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.AWS_REGION);
    if (isCloudEnv && !proxyUrl) {
      throw new Error(
        'YouTube blocked caption access from Render cloud datacenter IP. ' +
        'To enable transcription on Render, configure HTTPS_PROXY in Render Environment Variables (e.g., from webshare.io), or run locally via npm run tunnel.'
      );
    }
    throw new Error('No caption tracks found for this video. The creator may have disabled subtitles, or the video is private/restricted.');
  }

  // Smart track selection priority:
  // 1. User requested language (if provided)
  // 2. English track (en, en-US, en-GB, a.en)
  // 3. Auto-generated native track (kind: 'asr')
  // 4. First available caption track
  let selectedTrack = null;
  if (requestedLang && requestedLang !== 'auto') {
    selectedTrack = captionTracks.find(
      (t) => t.languageCode === requestedLang || t.vssId?.includes(`.${requestedLang}`)
    );
  }
  if (!selectedTrack) {
    selectedTrack = captionTracks.find((t) => t.languageCode?.startsWith('en'));
  }
  if (!selectedTrack) {
    selectedTrack = captionTracks.find((t) => t.kind === 'asr');
  }
  if (!selectedTrack) {
    selectedTrack = captionTracks[0];
  }

  // Fetch the timedtext XML using a proper browser user-agent
  const timedTextUrl = selectedTrack.baseUrl;
  const timedTextRes = await fetch(timedTextUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)',
    },
  });

  if (!timedTextRes.ok) {
    throw new Error(`Timedtext HTTP ${timedTextRes.status}`);
  }

  const xml = await timedTextRes.text();
  const items = [];

  // Parse modern format 3: <p t="ms" d="ms"><s>...</s></p>
  const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let match;
  while ((match = pRegex.exec(xml)) !== null) {
    const startMs = parseInt(match[1], 10);
    const durMs = parseInt(match[2], 10);
    let rawText = match[3]
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/\n/g, ' ')
      .trim();

    if (rawText) {
      items.push({
        text: rawText,
        offset: startMs,
        duration: durMs,
        lang: selectedTrack.languageCode || 'auto',
      });
    }
  }

  // Fallback to classic format: <text start="s" dur="s">...</text>
  if (items.length === 0) {
    const textRegex = /<text\s+start="([0-9.]+)"\s+dur="([0-9.]+)"[^>]*>([\s\S]*?)<\/text>/g;
    let tMatch;
    while ((tMatch = textRegex.exec(xml)) !== null) {
      const offsetSec = parseFloat(tMatch[1]);
      const durationSec = parseFloat(tMatch[2]);
      let rawText = tMatch[3]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/\n/g, ' ')
        .trim();

      if (rawText) {
        items.push({
          text: rawText,
          offset: Math.round(offsetSec * 1000),
          duration: Math.round(durationSec * 1000),
          lang: selectedTrack.languageCode || 'auto',
        });
      }
    }
  }

  if (items.length === 0) {
    throw new Error('Parsed 0 timedtext segments from caption tracks.');
  }

  const trackName = selectedTrack.name?.simpleText || selectedTrack.name?.runs?.[0]?.text || selectedTrack.languageCode;

  return {
    items,
    language: trackName || selectedTrack.languageCode || 'Original',
    languageCode: selectedTrack.languageCode || 'auto',
    availableTracks: captionTracks.map((t) => ({
      name: t.name?.simpleText || t.name?.runs?.[0]?.text || t.languageCode,
      code: t.languageCode,
      isAuto: Boolean(t.kind === 'asr'),
    })),
  };
}

/**
 * Format milliseconds into HH:MM:SS or MM:SS
 */
function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Groups rapid sentence fragments into readable coherent paragraphs with single timestamps
 */
function groupIntoParagraphs(items, pauseThresholdMs = 2000, targetWordsPerPara = 60) {
  const paragraphs = [];
  let currentGroup = [];
  let startTime = 0;
  let wordCount = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const prev = items[i - 1];

    if (currentGroup.length === 0) {
      startTime = item.offset;
    }

    const words = item.text.split(/\s+/).filter(Boolean);
    wordCount += words.length;

    let pause = 0;
    if (prev) {
      pause = item.offset - (prev.offset + prev.duration);
    }

    currentGroup.push(item.text);

    const isLast = i === items.length - 1;
    const endsWithPunctuation = /[.?!]$/.test(item.text.trim());

    // Break paragraph if:
    // 1. Natural punctuation after at least 25 words
    // 2. Significant pause (>2s) after at least 25 words
    // 3. Or word count reached target (e.g. 60 words) regardless of punctuation
    const shouldBreak =
      isLast ||
      (wordCount >= 25 && endsWithPunctuation) ||
      (wordCount >= 25 && pause >= pauseThresholdMs) ||
      wordCount >= targetWordsPerPara;

    if (shouldBreak) {
      paragraphs.push({
        timestamp: formatTime(startTime),
        startMs: startTime,
        text: currentGroup.join(' ').replace(/\s+/g, ' ').trim(),
      });
      currentGroup = [];
      wordCount = 0;
    }
  }

  if (currentGroup.length > 0) {
    paragraphs.push({
      timestamp: formatTime(startTime),
      startMs: startTime,
      text: currentGroup.join(' ').replace(/\s+/g, ' ').trim(),
    });
  }

  return paragraphs;
}

/**
 * API: /api/transcribe
 * Takes { url: string, lang?: string }
 */
app.post('/api/transcribe', async (req, res) => {
  try {
    const { url, lang } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid YouTube video URL or ID.',
      });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({
        success: false,
        error: 'Invalid YouTube URL or Video ID. Please check the link and try again.',
      });
    }

    // 1. Fetch metadata in parallel
    const metadataPromise = fetchVideoMetadata(videoId);

    // 2. Fetch transcript with multi-strategy fallback
    let transcriptItems = null;
    let trackLanguage = 'Original';
    let availableTracks = [];

    // Strategy 1: Direct Android InnerTube Gateway (Highest reliability on cloud hosts like Render)
    try {
      const directResult = await fetchDirectCaptionTracks(videoId, lang);
      transcriptItems = directResult.items;
      trackLanguage = getLanguageName(directResult.languageCode) || directResult.language;
      availableTracks = directResult.availableTracks;
    } catch (errDirect) {
      console.warn(`Strategy 1 (Direct Android Gateway) failed for ${videoId}:`, errDirect.message);

      // Strategy 2: youtube-transcript package fallback
      try {
        if (lang && lang !== 'auto') {
          transcriptItems = await YoutubeTranscript.fetchTranscript(videoId, { lang });
          trackLanguage = getLanguageName(lang);
        } else {
          transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
          const rawLang = transcriptItems[0]?.lang || 'Original';
          trackLanguage = getLanguageName(rawLang);
        }
      } catch (errLib) {
        console.warn(`Strategy 2 (youtube-transcript) failed for ${videoId}:`, errLib.message);
        throw new Error(
          errDirect.message || 'Could not retrieve transcript for this video. The creator may have disabled closed captions, or the video might be private/age-restricted.'
        );
      }
    }

    const metadata = await metadataPromise;

    if (!transcriptItems || transcriptItems.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No transcript segments were found for this video.',
      });
    }

    // Process raw items
    const formattedSegments = transcriptItems.map((item, idx) => ({
      id: idx + 1,
      startMs: item.offset,
      durationMs: item.duration,
      timestamp: formatTime(item.offset),
      text: item.text.replace(/\n/g, ' ').trim(),
    }));

    // Group into readable conversational paragraphs
    const paragraphs = groupIntoParagraphs(transcriptItems);

    // Continuous text with line break after every full stop and speaker change
    const rawFullText = transcriptItems
      .map((i) => i.text.replace(/\n/g, ' ').trim())
      .join(' ')
      .replace(/\s+/g, ' ');
    const fullText = formatContinuousText(rawFullText);

    // Calculate statistics
    const totalWords = rawFullText.split(/\s+/).filter(Boolean).length;
    const totalCharacters = rawFullText.length;
    const lastItem = transcriptItems[transcriptItems.length - 1];
    const totalDurationMs = lastItem ? lastItem.offset + lastItem.duration : 0;
    const formattedDuration = formatTime(totalDurationMs);
    const estimatedReadingTimeMinutes = Math.max(1, Math.ceil(totalWords / 200));

    // 3. Log transcript to content folder (one file per video, check content identity)
    const loggedFile = logTranscriptToContent({
      videoId,
      metadata,
      paragraphs,
      fullText,
      trackLanguage,
      stats: {
        duration: formattedDuration,
        totalWords,
      },
    });

    return res.json({
      success: true,
      videoId,
      metadata: {
        ...metadata,
        duration: formattedDuration,
        durationMs: totalDurationMs,
      },
      stats: {
        totalWords,
        totalCharacters,
        totalSegments: formattedSegments.length,
        totalParagraphs: paragraphs.length,
        readingTimeMinutes: estimatedReadingTimeMinutes,
        duration: formattedDuration,
        language: trackLanguage,
      },
      loggedFile,
      availableTracks,
      paragraphs,
      segments: formattedSegments,
      fullText,
    });
  } catch (error) {
    console.error('Transcription error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'An unexpected error occurred while transcribing the video.',
    });
  }
});

/**
 * Lists all logged transcript files from the content folder
 */
app.get('/api/content', (req, res) => {
  try {
    if (!fs.existsSync(CONTENT_DIR)) {
      return res.json({ success: true, count: 0, files: [] });
    }
    const entries = fs.readdirSync(CONTENT_DIR, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && e.name.endsWith('.txt'))
      .map((e) => {
        const fullPath = path.join(CONTENT_DIR, e.name);
        const stats = fs.statSync(fullPath);
        return {
          filename: e.name,
          relativePath: `content/${e.name}`,
          sizeBytes: stats.size,
          modifiedAt: stats.mtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));

    return res.json({ success: true, count: files.length, files });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Returns the text content of a specific logged transcript file
 */
app.get('/api/content/file', (req, res) => {
  try {
    const filename = req.query.name;
    if (!filename) {
      return res.status(400).json({ success: false, error: 'Filename parameter required' });
    }
    // Security: sanitize path traversal
    const safeName = path.basename(filename);
    const targetPath = path.join(CONTENT_DIR, safeName);
    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }
    const content = fs.readFileSync(targetPath, 'utf8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(content);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Health check
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'YouTranscribe API', time: new Date().toISOString() });
});

// Fallback to index.html for SPA
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(` TranscribeTube Server Running`);
  console.log(` Local:   http://localhost:${PORT}`);
  console.log(` API:     http://localhost:${PORT}/api/transcribe`);
  console.log(`===============================================`);
});
