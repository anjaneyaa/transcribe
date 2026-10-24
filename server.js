const express = require('express');
const cors = require('cors');
const path = require('path');
const { YoutubeTranscript } = require('youtube-transcript');

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

    // Continuous clean full text
    const fullText = transcriptItems
      .map((i) => i.text.replace(/\n/g, ' ').trim())
      .join(' ')
      .replace(/\s+/g, ' ');

    // Calculate statistics
    const totalWords = fullText.split(/\s+/).filter(Boolean).length;
    const totalCharacters = fullText.length;
    const lastItem = transcriptItems[transcriptItems.length - 1];
    const totalDurationMs = lastItem ? lastItem.offset + lastItem.duration : 0;
    const formattedDuration = formatTime(totalDurationMs);
    const estimatedReadingTimeMinutes = Math.max(1, Math.ceil(totalWords / 200));

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
