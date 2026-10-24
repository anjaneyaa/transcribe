const express = require('express');
const cors = require('cors');
const path = require('path');
const { YoutubeTranscript } = require('youtube-transcript');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
 * Strategy 2: Direct YouTube HTML and timedtext caption parser
 */
async function fetchDirectTimedText(videoId, lang = 'en') {
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
  if (!playerResponseMatch) {
    throw new Error('ytInitialPlayerResponse not found in page');
  }

  const playerResponse = JSON.parse(playerResponseMatch[1]);
  const captionTracks =
    playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!captionTracks || captionTracks.length === 0) {
    throw new Error('No caption tracks found in player response');
  }

  // Find track matching language or fallback to first track
  let selectedTrack = captionTracks.find(
    (t) => t.languageCode === lang || t.vssId?.includes(`.${lang}`)
  );
  if (!selectedTrack) {
    selectedTrack = captionTracks.find((t) => t.languageCode?.startsWith('en'));
  }
  if (!selectedTrack) {
    selectedTrack = captionTracks[0];
  }

  const timedTextUrl = selectedTrack.baseUrl;
  const timedTextRes = await fetch(timedTextUrl);
  const timedTextXml = await timedTextRes.text();

  // Parse XML text tags: <text start="1.23" dur="4.56">content</text>
  const regex = /<text\s+start="([0-9.]+)"\s+dur="([0-9.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  const items = [];
  let match;

  while ((match = regex.exec(timedTextXml)) !== null) {
    const offsetSec = parseFloat(match[1]);
    const durationSec = parseFloat(match[2]);
    let rawText = match[3]
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
        lang: selectedTrack.languageCode || 'en',
      });
    }
  }

  if (items.length === 0) {
    throw new Error('Parsed 0 timedtext segments');
  }

  return {
    items,
    language: selectedTrack.name?.simpleText || selectedTrack.languageCode || 'English',
    languageCode: selectedTrack.languageCode || 'en',
    availableTracks: captionTracks.map((t) => ({
      name: t.name?.simpleText || t.languageCode,
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
    const { url, lang = 'en' } = req.body;

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
    let trackLanguage = 'English';
    let availableTracks = [];

    // Attempt Strategy 1: youtube-transcript package
    try {
      transcriptItems = await YoutubeTranscript.fetchTranscript(videoId, { lang });
      trackLanguage = lang;
    } catch (err1) {
      console.warn(`Strategy 1 (youtube-transcript) failed for ${videoId}:`, err1.message);

      // Attempt Strategy 2: Direct timedtext caption extractor
      try {
        const directResult = await fetchDirectTimedText(videoId, lang);
        transcriptItems = directResult.items;
        trackLanguage = directResult.language;
        availableTracks = directResult.availableTracks;
      } catch (err2) {
        console.warn(`Strategy 2 (Direct Timedtext) failed for ${videoId}:`, err2.message);
        throw new Error(
          'Could not retrieve transcript for this video. The creator may have disabled closed captions, or the video might be private/age-restricted.'
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

app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(` TranscribeTube Server Running`);
  console.log(` Local:   http://localhost:${PORT}`);
  console.log(` API:     http://localhost:${PORT}/api/transcribe`);
  console.log(`===============================================`);
});
