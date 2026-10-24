// State
let currentTranscription = null;
let activeSearchQuery = '';
let currentTab = 'timestamped';

// DOM Elements
const transcribeForm = document.getElementById('transcribe-form');
const urlInput = document.getElementById('youtube-url-input');
const btnSubmit = document.getElementById('btn-submit');
const btnPaste = document.getElementById('btn-paste');
const loadingContainer = document.getElementById('loading-container');
const loadingStatusText = document.getElementById('loading-status-text');
const errorContainer = document.getElementById('error-container');
const errorMessage = document.getElementById('error-message');
const btnDismissError = document.getElementById('btn-dismiss-error');
const resultSection = document.getElementById('result-section');
const btnClearAll = document.getElementById('btn-clear-all');

// Video Details DOM
const videoThumbnail = document.getElementById('video-thumbnail');
const videoTitle = document.getElementById('video-title');
const authorName = document.getElementById('author-name');
const durationVal = document.getElementById('duration-val');
const badgeLanguage = document.getElementById('badge-language');
const statWords = document.getElementById('stat-words');
const statDuration = document.getElementById('stat-duration');
const statReadTime = document.getElementById('stat-read-time');
const statSegments = document.getElementById('stat-segments');

// Player DOM
const btnTogglePlayer = document.getElementById('btn-toggle-player');
const playerContainer = document.getElementById('player-container');
const youtubeIframe = document.getElementById('youtube-iframe');

// Content Containers
const paragraphsContainer = document.getElementById('paragraphs-container');
const cleanTextContent = document.getElementById('clean-text-content');
const summaryContent = document.getElementById('summary-content');

// Search DOM
const searchInput = document.getElementById('search-input');
const btnClearSearch = document.getElementById('btn-clear-search');
const searchCount = document.getElementById('search-count');
const matchCount = document.getElementById('match-count');

// Export DOM
const btnCopyFull = document.getElementById('btn-copy-full');
const btnCopyTimestamps = document.getElementById('btn-copy-timestamps');
const btnDownloadMenu = document.getElementById('btn-download-menu');
const downloadDropdown = document.getElementById('download-dropdown');
const btnDownloadTxt = document.getElementById('btn-download-txt');
const btnDownloadSrt = document.getElementById('btn-download-srt');
const btnDownloadVtt = document.getElementById('btn-download-vtt');
const btnDownloadJson = document.getElementById('btn-download-json');

// Tabs DOM
const tabBtnTimestamped = document.getElementById('tab-btn-timestamped');
const tabBtnClean = document.getElementById('tab-btn-clean');
const tabBtnSummary = document.getElementById('tab-btn-summary');
const viewTimestamped = document.getElementById('view-timestamped');
const viewClean = document.getElementById('view-clean');
const viewSummary = document.getElementById('view-summary');

// History DOM
const historyGrid = document.getElementById('history-grid');
const historyEmpty = document.getElementById('history-empty');
const historyBadge = document.getElementById('history-badge');
const btnClearHistory = document.getElementById('btn-clear-history');

// Toast
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    lucide.createIcons();
  }
  loadHistoryFromStorage();
  setupEventListeners();
});

function setupEventListeners() {
  // Form submission
  transcribeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (url) {
      startTranscription(url);
    }
  });

  // Paste from clipboard
  btnPaste.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        urlInput.value = text.trim();
        urlInput.focus();
        showToast('Link pasted from clipboard');
      }
    } catch {
      urlInput.focus();
    }
  });

  // Sample Buttons
  document.querySelectorAll('.sample-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sampleUrl = btn.getAttribute('data-url');
      if (sampleUrl) {
        urlInput.value = sampleUrl;
        startTranscription(sampleUrl);
      }
    });
  });

  // Error dismiss
  btnDismissError.addEventListener('click', () => {
    errorContainer.classList.add('hidden');
  });

  // Clear all
  btnClearAll.addEventListener('click', () => {
    urlInput.value = '';
    resultSection.classList.add('hidden');
    errorContainer.classList.add('hidden');
    currentTranscription = null;
    playerContainer.classList.add('hidden');
    youtubeIframe.src = '';
    urlInput.focus();
  });

  // Toggle Video Player
  btnTogglePlayer.addEventListener('click', () => {
    if (!currentTranscription) return;
    const isHidden = playerContainer.classList.contains('hidden');
    if (isHidden) {
      playerContainer.classList.remove('hidden');
      youtubeIframe.src = `https://www.youtube.com/embed/${currentTranscription.videoId}?autoplay=1&enablejsapi=1`;
    } else {
      playerContainer.classList.add('hidden');
      youtubeIframe.src = '';
    }
  });

  // Tabs
  tabBtnTimestamped.addEventListener('click', () => switchTab('timestamped'));
  tabBtnClean.addEventListener('click', () => switchTab('clean'));
  tabBtnSummary.addEventListener('click', () => switchTab('summary'));

  // Search
  searchInput.addEventListener('input', (e) => {
    activeSearchQuery = e.target.value.trim().toLowerCase();
    if (activeSearchQuery) {
      btnClearSearch.classList.remove('hidden');
    } else {
      btnClearSearch.classList.add('hidden');
    }
    renderFilteredContent();
  });

  btnClearSearch.addEventListener('click', () => {
    searchInput.value = '';
    activeSearchQuery = '';
    btnClearSearch.classList.add('hidden');
    searchCount.classList.add('hidden');
    renderFilteredContent();
  });

  // Copy buttons
  btnCopyFull.addEventListener('click', () => {
    if (!currentTranscription) return;
    copyToClipboard(currentTranscription.fullText, 'Full transcript copied to clipboard!');
  });

  btnCopyTimestamps.addEventListener('click', () => {
    if (!currentTranscription) return;
    const timestampedText = currentTranscription.paragraphs
      .map((p) => `[${p.timestamp}] ${p.text}`)
      .join('\n\n');
    copyToClipboard(timestampedText, 'Timestamped transcript copied to clipboard!');
  });

  // Download menu
  btnDownloadMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    downloadDropdown.classList.toggle('hidden');
  });

  document.addEventListener('click', () => {
    downloadDropdown.classList.add('hidden');
  });

  btnDownloadTxt.addEventListener('click', () => downloadFile('txt'));
  btnDownloadSrt.addEventListener('click', () => downloadFile('srt'));
  btnDownloadVtt.addEventListener('click', () => downloadFile('vtt'));
  btnDownloadJson.addEventListener('click', () => downloadFile('json'));

  // Clear history
  btnClearHistory.addEventListener('click', () => {
    localStorage.removeItem('youtranscribe_history_v1');
    renderHistory([]);
    showToast('Transcription history cleared');
  });
}

/**
 * Executes full-length transcription via backend API
 */
async function startTranscription(url) {
  // Reset states
  errorContainer.classList.add('hidden');
  resultSection.classList.add('hidden');
  loadingContainer.classList.remove('hidden');
  btnSubmit.disabled = true;

  // Animated loading messages
  const loadingSteps = [
    'Connecting to YouTube video...',
    'Extracting full length audio caption tracks...',
    'Processing entire timestamps (0:00 to end)...',
    'Generating coherent paragraphs and summary...',
  ];
  let stepIndex = 0;
  loadingStatusText.textContent = loadingSteps[0];
  const stepInterval = setInterval(() => {
    stepIndex = (stepIndex + 1) % loadingSteps.length;
    loadingStatusText.textContent = loadingSteps[stepIndex];
  }, 2200);

  try {
    const res = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await res.json();
    clearInterval(stepInterval);
    loadingContainer.classList.add('hidden');
    btnSubmit.disabled = false;

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to transcribe video.');
    }

    currentTranscription = data;
    renderTranscriptionResult(data);
    saveToHistory(data);
    showToast('Video transcribed successfully!');

    // Smooth scroll to result
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    clearInterval(stepInterval);
    loadingContainer.classList.add('hidden');
    btnSubmit.disabled = false;
    showError(err.message || 'An unexpected error occurred.');
  }
}

/**
 * Renders complete transcription details in DOM
 */
function renderTranscriptionResult(data) {
  const { metadata, stats, videoId } = data;

  // Metadata
  videoTitle.textContent = metadata.title;
  authorName.textContent = metadata.author;
  durationVal.textContent = metadata.duration;
  videoThumbnail.src = metadata.maxresThumbnailUrl || metadata.thumbnailUrl;
  videoThumbnail.onerror = () => {
    videoThumbnail.src = metadata.thumbnailUrl;
  };
  badgeLanguage.textContent = stats.language || 'English';

  // Stats
  statWords.textContent = stats.totalWords.toLocaleString();
  statDuration.textContent = stats.duration;
  statReadTime.textContent = `${stats.readingTimeMinutes} min`;
  statSegments.textContent = stats.totalSegments.toLocaleString();

  // Reset search
  searchInput.value = '';
  activeSearchQuery = '';
  btnClearSearch.classList.add('hidden');
  searchCount.classList.add('hidden');

  // Render content
  renderFilteredContent();

  // Render AI Summary / Key Highlights
  renderSummary(data);

  // Default to timestamped tab
  switchTab('timestamped');

  resultSection.classList.remove('hidden');

  if (window.lucide) {
    lucide.createIcons();
  }
}

/**
 * Renders timestamped paragraphs and clean text (with search filtering)
 */
function renderFilteredContent() {
  if (!currentTranscription) return;

  const { paragraphs, fullText } = currentTranscription;
  const q = activeSearchQuery;

  // 1. Timestamped View
  paragraphsContainer.innerHTML = '';
  let matchTotal = 0;

  paragraphs.forEach((p, index) => {
    const textLower = p.text.toLowerCase();
    const isMatch = q ? textLower.includes(q) : true;

    if (q && isMatch) {
      const occurrences = (textLower.match(new RegExp(escapeRegExp(q), 'g')) || []).length;
      matchTotal += occurrences;
    }

    if (isMatch) {
      const pEl = document.createElement('div');
      pEl.className = 'group p-3.5 rounded-2xl bg-slate-900/60 hover:bg-slate-900 border border-slate-800/80 hover:border-slate-700 transition flex items-start gap-3.5';

      let highlightedHtml = escapeHtml(p.text);
      if (q) {
        const regex = new RegExp(`(${escapeRegExp(q)})`, 'gi');
        highlightedHtml = highlightedHtml.replace(regex, '<mark class="search-highlight">$1</mark>');
      }

      pEl.innerHTML = `
        <button 
          type="button" 
          class="btn-seek shrink-0 inline-flex items-center gap-1 font-mono text-[11px] font-bold px-2.5 py-1 rounded-xl bg-indigo-500/10 hover:bg-indigo-600 hover:text-white text-indigo-400 border border-indigo-500/20 transition active:scale-95"
          data-time="${p.startMs}"
          title="Play from ${p.timestamp}"
        >
          <i data-lucide="play" class="w-3 h-3 fill-current"></i>
          <span>${p.timestamp}</span>
        </button>
        <div class="flex-1 min-w-0">
          <p class="text-xs sm:text-sm text-slate-300 leading-relaxed">${highlightedHtml}</p>
        </div>
        <button 
          type="button"
          class="btn-copy-para opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          data-text="${escapeAttr(p.text)}"
          title="Copy this paragraph"
        >
          <i data-lucide="copy" class="w-3.5 h-3.5"></i>
        </button>
      `;

      paragraphsContainer.appendChild(pEl);
    }
  });

  if (paragraphsContainer.children.length === 0) {
    paragraphsContainer.innerHTML = `
      <div class="text-center py-10 text-xs text-slate-500">
        No segments found matching "<span class="text-slate-300 font-bold">${escapeHtml(q)}</span>".
      </div>
    `;
  }

  // Bind click-to-seek buttons
  paragraphsContainer.querySelectorAll('.btn-seek').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ms = parseInt(btn.getAttribute('data-time'), 10) || 0;
      seekToTime(ms);
    });
  });

  // Bind paragraph copy buttons
  paragraphsContainer.querySelectorAll('.btn-copy-para').forEach((btn) => {
    btn.addEventListener('click', () => {
      const text = btn.getAttribute('data-text') || '';
      copyToClipboard(text, 'Paragraph copied!');
    });
  });

  // 2. Clean Text View
  let cleanHtml = escapeHtml(fullText);
  if (q) {
    const regex = new RegExp(`(${escapeRegExp(q)})`, 'gi');
    cleanHtml = cleanHtml.replace(regex, '<mark class="search-highlight">$1</mark>');
  }
  cleanTextContent.innerHTML = cleanHtml;

  // Search match badge
  if (q) {
    searchCount.classList.remove('hidden');
    matchCount.textContent = matchTotal;
  } else {
    searchCount.classList.add('hidden');
  }

  if (window.lucide) {
    lucide.createIcons();
  }
}

/**
 * Generates structured key takeaways and summary highlights
 */
function renderSummary(data) {
  const { paragraphs, fullText, stats } = data;
  summaryContent.innerHTML = '';

  // Extract key topic milestones (every few minutes or significant paragraphs)
  const step = Math.max(1, Math.floor(paragraphs.length / 5));
  const milestones = [];
  for (let i = 0; i < paragraphs.length; i += step) {
    milestones.push(paragraphs[i]);
    if (milestones.length >= 5) break;
  }

  const overviewCard = document.createElement('div');
  overviewCard.className = 'p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2';
  overviewCard.innerHTML = `
    <h4 class="font-bold text-slate-200 flex items-center gap-2">
      <i data-lucide="book-open" class="w-4 h-4 text-indigo-400"></i>
      Video Overview
    </h4>
    <p class="text-xs text-slate-400 leading-relaxed">
      This video runs for <strong class="text-slate-200">${stats.duration}</strong> with a total transcript volume of <strong class="text-slate-200">${stats.totalWords.toLocaleString()} words</strong> (~${stats.readingTimeMinutes} minutes reading time).
    </p>
  `;
  summaryContent.appendChild(overviewCard);

  const topicsCard = document.createElement('div');
  topicsCard.className = 'p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3';
  topicsCard.innerHTML = `
    <h4 class="font-bold text-slate-200 flex items-center gap-2">
      <i data-lucide="compass" class="w-4 h-4 text-violet-400"></i>
      Timeline Key Points &amp; Milestones
    </h4>
    <div class="space-y-2.5">
      ${milestones
        .map(
          (m, idx) => `
        <div class="flex items-start gap-2.5">
          <button type="button" class="btn-seek shrink-0 font-mono text-[10px] font-bold px-2 py-0.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-600 hover:text-white text-indigo-400 border border-indigo-500/20 transition" data-time="${m.startMs}">
            ${m.timestamp}
          </button>
          <p class="text-xs text-slate-300 leading-relaxed">${escapeHtml(m.text.slice(0, 150))}${m.text.length > 150 ? '...' : ''}</p>
        </div>
      `
        )
        .join('')}
    </div>
  `;
  summaryContent.appendChild(topicsCard);

  topicsCard.querySelectorAll('.btn-seek').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ms = parseInt(btn.getAttribute('data-time'), 10) || 0;
      seekToTime(ms);
    });
  });

  if (window.lucide) {
    lucide.createIcons();
  }
}

/**
 * Jumps to time in embedded video player
 */
function seekToTime(ms) {
  if (!currentTranscription) return;
  const seconds = Math.floor(ms / 1000);

  // If player is not open, open it
  if (playerContainer.classList.contains('hidden')) {
    playerContainer.classList.remove('hidden');
  }

  youtubeIframe.src = `https://www.youtube.com/embed/${currentTranscription.videoId}?autoplay=1&start=${seconds}&enablejsapi=1`;

  // Scroll to player smoothly
  playerContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
  showToast(`Jumped video to ${formatTime(ms)}`);
}

/**
 * Tab switcher
 */
function switchTab(tabId) {
  currentTab = tabId;

  // Buttons
  [tabBtnTimestamped, tabBtnClean, tabBtnSummary].forEach((btn) => {
    btn.classList.remove('active', 'border-b-2', 'border-indigo-500', 'text-indigo-400', 'bg-slate-900/40');
    btn.classList.add('text-slate-400');
  });

  // Views
  [viewTimestamped, viewClean, viewSummary].forEach((view) => {
    view.classList.add('hidden');
  });

  if (tabId === 'timestamped') {
    tabBtnTimestamped.classList.add('active', 'border-b-2', 'border-indigo-500', 'text-indigo-400', 'bg-slate-900/40');
    tabBtnTimestamped.classList.remove('text-slate-400');
    viewTimestamped.classList.remove('hidden');
  } else if (tabId === 'clean') {
    tabBtnClean.classList.add('active', 'border-b-2', 'border-indigo-500', 'text-indigo-400', 'bg-slate-900/40');
    tabBtnClean.classList.remove('text-slate-400');
    viewClean.classList.remove('hidden');
  } else if (tabId === 'summary') {
    tabBtnSummary.classList.add('active', 'border-b-2', 'border-indigo-500', 'text-indigo-400', 'bg-slate-900/40');
    tabBtnSummary.classList.remove('text-slate-400');
    viewSummary.classList.remove('hidden');
  }
}

/**
 * Downloads file in chosen format
 */
function downloadFile(format) {
  if (!currentTranscription) return;

  const { metadata, fullText, segments, paragraphs, videoId } = currentTranscription;
  const safeTitle = (metadata.title || videoId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);

  let content = '';
  let filename = '';
  let mimeType = 'text/plain';

  if (format === 'txt') {
    content = `TITLE: ${metadata.title}\nAUTHOR: ${metadata.author}\nDURATION: ${metadata.duration}\nURL: https://www.youtube.com/watch?v=${videoId}\n\n==================== FULL TRANSCRIPT ====================\n\n${fullText}`;
    filename = `${safeTitle}-transcript.txt`;
  } else if (format === 'srt') {
    content = segments
      .map((s, idx) => {
        const start = formatSrtTime(s.startMs);
        const end = formatSrtTime(s.startMs + s.durationMs);
        return `${idx + 1}\n${start} --> ${end}\n${s.text}\n`;
      })
      .join('\n');
    filename = `${safeTitle}.srt`;
  } else if (format === 'vtt') {
    content =
      'WEBVTT\n\n' +
      segments
        .map((s, idx) => {
          const start = formatVttTime(s.startMs);
          const end = formatVttTime(s.startMs + s.durationMs);
          return `${idx + 1}\n${start} --> ${end}\n${s.text}\n`;
        })
        .join('\n');
    filename = `${safeTitle}.vtt`;
  } else if (format === 'json') {
    content = JSON.stringify(currentTranscription, null, 2);
    filename = `${safeTitle}-transcript.json`;
    mimeType = 'application/json';
  }

  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  showToast(`Downloaded ${filename}!`);
}

/**
 * Format milliseconds into SRT timestamp: 00:01:23,456
 */
function formatSrtTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

/**
 * Format milliseconds into WebVTT timestamp: 00:01:23.456
 */
function formatVttTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

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
 * Clipboard copy
 */
async function copyToClipboard(text, message = 'Copied to clipboard!') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(message);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast(message);
  }
}

/**
 * LocalStorage history management
 */
function saveToHistory(data) {
  try {
    const history = getHistory();
    const existingIndex = history.findIndex((h) => h.videoId === data.videoId);
    const item = {
      videoId: data.videoId,
      title: data.metadata.title,
      author: data.metadata.author,
      thumbnailUrl: data.metadata.thumbnailUrl,
      duration: data.metadata.duration,
      words: data.stats.totalWords,
      timestamp: Date.now(),
      data,
    };

    if (existingIndex !== -1) {
      history.splice(existingIndex, 1);
    }
    history.unshift(item);

    // Keep top 12
    const trimmed = history.slice(0, 12);
    localStorage.setItem('youtranscribe_history_v1', JSON.stringify(trimmed));
    renderHistory(trimmed);
  } catch (err) {
    console.warn('Failed to save history', err);
  }
}

function getHistory() {
  try {
    const raw = localStorage.getItem('youtranscribe_history_v1');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function loadHistoryFromStorage() {
  const history = getHistory();
  renderHistory(history);
}

function renderHistory(history) {
  historyBadge.textContent = history.length;

  if (history.length === 0) {
    historyGrid.innerHTML = '';
    historyEmpty.classList.remove('hidden');
    return;
  }

  historyEmpty.classList.add('hidden');
  historyGrid.innerHTML = '';

  history.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'group cursor-pointer p-3 rounded-2xl bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-indigo-500/50 transition flex items-center gap-3';
    card.innerHTML = `
      <img src="${item.thumbnailUrl}" alt="" class="w-16 h-10 object-cover rounded-xl shrink-0 bg-slate-950 border border-slate-800" />
      <div class="flex-1 min-w-0">
        <h4 class="text-xs font-bold text-slate-200 truncate group-hover:text-indigo-400 transition">${escapeHtml(item.title)}</h4>
        <div class="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5">
          <span>${item.duration}</span>
          <span>•</span>
          <span>${item.words.toLocaleString()} words</span>
        </div>
      </div>
    `;

    card.addEventListener('click', () => {
      urlInput.value = `https://www.youtube.com/watch?v=${item.videoId}`;
      currentTranscription = item.data;
      renderTranscriptionResult(item.data);
      resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    historyGrid.appendChild(card);
  });
}

function showError(msg) {
  errorMessage.textContent = msg;
  errorContainer.classList.remove('hidden');
  errorContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showToast(msg) {
  toastMessage.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return (str || '').replace(/"/g, '&quot;');
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

