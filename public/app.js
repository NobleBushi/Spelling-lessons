const STORAGE_KEY = "spelling-lessons-history-v2";
const LEGACY_STORAGE_KEYS = ["talking-with-will-history-v1"];
const GRAMMAR_MODEL_ID = "Xenova/grammar-synthesis-small";
const TRANSFORMERS_CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/+esm";

const modeDescriptions = {
  off: "Off. The app reads exactly what was entered and scores the phrase.",
  on: "On. Conversation mode is reserved for later, so it still reads the typed phrase locally.",
};

const commonWords = new Set([
  "a", "am", "an", "and", "apple", "are", "ate", "baby", "ball", "banana", "be", "bear", "bed", "bird",
  "blue", "book", "boy", "bread", "brown", "bug", "bus", "can", "cat", "chair", "chicken", "clean",
  "close", "come", "cookie", "cow", "dad", "dance", "day", "dog", "door", "drink", "duck", "eat", "egg",
  "elephant", "every", "family", "fast", "fish", "five", "flower", "fly", "food", "for", "four", "friend",
  "frog", "fun", "game", "get", "girl", "go", "good", "green", "happy", "hat", "have", "he", "hello", "help",
  "her", "here", "home", "horse", "house", "how", "hug", "i", "ice", "in", "is", "it", "jump", "juice",
  "kid", "kite", "know", "laugh", "leg", "like", "lion", "little", "look", "love", "make", "me", "milk",
  "mom", "moon", "more", "my", "nap", "nice", "no", "not", "now", "of", "on", "one", "open", "orange", "our",
  "outside", "paper", "park", "pet", "pig", "play", "please", "purple", "quiet", "rabbit", "rain", "read",
  "red", "ride", "robot", "run", "sad", "school", "see", "seven", "she", "ship", "shoe", "sing", "sit", "six",
  "sleep", "slow", "smile", "snack", "snow", "so", "song", "sorry", "spell", "star", "stop", "sun", "swim",
  "table", "thank", "the", "their", "there", "they", "three", "to", "today", "tree", "truck", "two", "up",
  "very", "walk", "want", "warm", "we", "well", "what", "when", "where", "white", "who", "why", "will", "with",
  "yellow", "yes", "you", "your"
]);

const dom = {
  entryForm: document.getElementById("entryForm"),
  phraseInput: document.getElementById("phraseInput"),
  historyList: document.getElementById("historyList"),
  template: document.getElementById("historyItemTemplate"),
  voiceSelect: document.getElementById("voiceSelect"),
  rateInput: document.getElementById("rateInput"),
  conversationToggle: document.getElementById("conversationToggle"),
  modeDescription: document.getElementById("modeDescription"),
  clearHistoryButton: document.getElementById("clearHistoryButton"),
  modelStatusBadge: document.getElementById("modelStatusBadge"),
  modelStatusDetail: document.getElementById("modelStatusDetail"),
  retryModelButton: document.getElementById("retryModelButton"),
  submitButton: document.querySelector('#entryForm button[type="submit"]'),
};

let appState = {
  mode: "off",
  history: loadHistory(),
  voices: [],
  isSubmitting: false,
  checker: {
    status: "loading",
    detail: "Preparing the local grammar checker.",
    modelId: GRAMMAR_MODEL_ID,
    generator: null,
    loadPromise: null,
    lastError: "",
  },
};

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return sortHistoryChronologically(JSON.parse(raw));
    }

    for (const key of LEGACY_STORAGE_KEYS) {
      const legacyRaw = localStorage.getItem(key);
      if (legacyRaw) {
        return sortHistoryChronologically(JSON.parse(legacyRaw));
      }
    }

    return [];
  } catch {
    return [];
  }
}

function sortHistoryChronologically(history) {
  return Array.isArray(history)
    ? [...history].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    : [];
}

function saveHistory() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appState.history));
}

function updateCheckerStatus(status, detail) {
  appState.checker.status = status;
  appState.checker.detail = detail;

  dom.modelStatusBadge.textContent =
    status === "ready" ? "Model ready" : status === "fallback" ? "Fallback mode" : "Loading";
  dom.modelStatusBadge.className = `status-badge status-${status}`;
  dom.modelStatusDetail.textContent = detail;
  dom.retryModelButton.hidden = status !== "fallback";
}

function setSubmitting(isSubmitting) {
  appState.isSubmitting = isSubmitting;
  dom.submitButton.disabled = isSubmitting;
  dom.submitButton.textContent = isSubmitting ? "Checking..." : "Speak";
}

function severityForRating(rating) {
  if (rating === "incorrect") return 2;
  if (rating === "warning") return 1;
  return 0;
}

function labelForRating(rating) {
  if (rating === "incorrect") return "Needs work";
  if (rating === "warning") return "Almost there";
  return "Excellent phrase";
}

function heuristicScorePhrase(text, reason = "") {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      rating: "incorrect",
      label: "Needs work",
      feedback: "Type something first so the app has words to read.",
      checker: "heuristic",
    };
  }

  const words = trimmed.toLowerCase().match(/[a-z']+/g) || [];

  if (!words.length) {
    return {
      rating: "incorrect",
      label: "Needs work",
      feedback: "This looks more like symbols than words, but it can still be spoken.",
      checker: "heuristic",
    };
  }

  const misspelled = words.filter((word) => !commonWords.has(word) && !looksLikeSimpleWordForm(word));
  const punctuationLooksGood = words.length === 1 || /[.!?]$/.test(trimmed);
  const startsNicely = words.length === 1 || /^[A-Z]/.test(trimmed);
  const lowercaseI = /\bi\b/.test(trimmed);
  const repeatedSpaces = /\s{2,}/.test(trimmed);
  const hasSeriousIssue = misspelled.length >= Math.max(2, Math.ceil(words.length / 2));

  if (!misspelled.length && punctuationLooksGood && startsNicely && !lowercaseI && !repeatedSpaces) {
    return {
      rating: "excellent",
      label: "Excellent phrase",
      feedback: buildFallbackFeedback("Spelling and sentence form both look strong.", reason),
      checker: "heuristic",
    };
  }

  if (!hasSeriousIssue) {
    const notes = [];
    if (misspelled.length) {
      notes.push(`Check spelling: ${misspelled.slice(0, 3).join(", ")}`);
    }
    if (!startsNicely || !punctuationLooksGood || lowercaseI || repeatedSpaces) {
      notes.push("The words are mostly right, but the sentence form could be cleaner.");
    }

    return {
      rating: "warning",
      label: "Almost there",
      feedback: buildFallbackFeedback(notes.join(" "), reason),
      checker: "heuristic",
    };
  }

  return {
    rating: "incorrect",
    label: "Needs work",
    feedback: buildFallbackFeedback(
      misspelled.length
        ? `Several words may be misspelled: ${misspelled.slice(0, 4).join(", ")}.`
        : "The phrase structure looks incomplete.",
      reason
    ),
    checker: "heuristic",
  };
}

function buildFallbackFeedback(message, reason) {
  return reason ? `${message} Using the rule-based fallback because ${reason}.` : message;
}

function looksLikeSimpleWordForm(word) {
  if (commonWords.has(word)) {
    return true;
  }

  const candidates = [
    word.replace(/s$/, ""),
    word.replace(/es$/, ""),
    word.replace(/ed$/, ""),
    word.replace(/ing$/, ""),
  ];

  return candidates.some((candidate) => candidate && commonWords.has(candidate));
}

async function ensureGrammarModel() {
  if (appState.checker.generator) {
    return appState.checker.generator;
  }

  if (appState.checker.loadPromise) {
    return appState.checker.loadPromise;
  }

  updateCheckerStatus("loading", "Loading the browser grammar model. The first successful run can take a while.");

  appState.checker.loadPromise = (async () => {
    try {
      const { pipeline, env } = await import(TRANSFORMERS_CDN);

      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      env.useBrowserCache = true;

      if (env.backends?.onnx?.wasm) {
        env.backends.onnx.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 2);
      }

      const generator = await pipeline("text2text-generation", GRAMMAR_MODEL_ID, {
        progress_callback: handleModelProgress,
      });

      appState.checker.generator = generator;
      appState.checker.lastError = "";
      updateCheckerStatus("ready", "Grammar model loaded in the browser and ready for local checks.");
      return generator;
    } catch (error) {
      const reason = describeModelError(error);
      appState.checker.generator = null;
      appState.checker.lastError = reason;
      updateCheckerStatus("fallback", `Using the rule-based checker. ${reason}`);
      return null;
    } finally {
      appState.checker.loadPromise = null;
    }
  })();

  return appState.checker.loadPromise;
}

function handleModelProgress(progress) {
  if (!progress) {
    return;
  }

  const file = progress.file || progress.name || "model files";
  if (typeof progress.progress === "number" && Number.isFinite(progress.progress)) {
    updateCheckerStatus("loading", `Loading ${file} (${Math.round(progress.progress)}%).`);
    return;
  }

  updateCheckerStatus("loading", `Loading ${file}.`);
}

function describeModelError(error) {
  const message = String(error?.message || error || "model loading failed");

  if (/fetch|network|failed to fetch|load failed/i.test(message)) {
    return "the model could not be fetched. If you load it once while online, later runs can use the browser cache.";
  }

  if (/wasm|onnx|backend/i.test(message)) {
    return "the browser runtime could not start the local model backend on this machine.";
  }

  return "the grammar model failed to load on this browser.";
}

async function scorePhrase(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return heuristicScorePhrase(trimmed);
  }

  const heuristic = heuristicScorePhrase(trimmed);

  const generator = await ensureGrammarModel();
  if (!generator) {
    return {
      ...heuristic,
      tooltip: heuristic.feedback,
    };
  }

  try {
    const result = await generator(trimmed, {
      max_new_tokens: Math.max(24, Math.min(96, trimmed.length + 16)),
      temperature: 0,
    });
    const corrected = extractGeneratedText(result);

    if (!corrected) {
      const fallback = heuristicScorePhrase(trimmed, "the model returned an empty correction");
      return {
        ...fallback,
        tooltip: fallback.feedback,
      };
    }

    return combineAnalyses(heuristic, analyzeModelCorrection(trimmed, corrected));
  } catch (error) {
    const reason = describeModelError(error);
    appState.checker.generator = null;
    appState.checker.lastError = reason;
    updateCheckerStatus("fallback", `Using the rule-based checker. ${reason}`);
    const fallback = heuristicScorePhrase(trimmed, reason);
    return {
      ...fallback,
      tooltip: fallback.feedback,
    };
  }
}

function extractGeneratedText(result) {
  if (!Array.isArray(result) || !result.length) {
    return "";
  }

  const value = result[0]?.generated_text || result[0]?.summary_text || "";
  return String(value).trim();
}

function analyzeModelCorrection(original, corrected) {
  const cleanOriginal = normalizeWhitespace(original);
  const cleanCorrected = normalizeWhitespace(corrected);
  const originalLoose = normalizeLoose(original);
  const correctedLoose = normalizeLoose(corrected);
  const distance = levenshteinDistance(originalLoose, correctedLoose);
  const ratio = distance / Math.max(originalLoose.length, correctedLoose.length, 1);
  const wordDelta = countWordDelta(originalLoose, correctedLoose);
  const correctionPreview = cleanCorrected === cleanOriginal ? "" : ` Suggested: "${cleanCorrected}"`;

  if (cleanOriginal === cleanCorrected) {
    return {
      rating: "excellent",
      label: "Excellent phrase",
      feedback: "The local grammar model did not suggest any spelling or grammar changes.",
      checker: "model",
    };
  }

  if (ratio <= 0.12 || wordDelta <= 2) {
    return {
      rating: "warning",
      label: "Almost there",
      feedback: `The local grammar model found a small cleanup.${correctionPreview}`,
      checker: "model",
    };
  }

  return {
    rating: "incorrect",
    label: "Needs work",
    feedback: `The local grammar model suggests a stronger rewrite.${correctionPreview}`,
    checker: "model",
  };
}

function combineAnalyses(heuristic, model) {
  const combinedRating =
    severityForRating(model.rating) > severityForRating(heuristic.rating) ? model.rating : heuristic.rating;
  const tooltipParts = [];

  if (heuristic.feedback) {
    tooltipParts.push(`Heuristic: ${heuristic.feedback}`);
  }

  if (model.feedback) {
    tooltipParts.push(`Model: ${model.feedback}`);
  }

  return {
    rating: combinedRating,
    label: labelForRating(combinedRating),
    feedback: "",
    tooltip: tooltipParts.join("\n\n"),
    checker: model.checker,
    heuristic,
    model,
  };
}

function normalizeWhitespace(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeLoose(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[“”]/g, "\"")
    .replace(/[’]/g, "'")
    .replace(/\s+([,.!?;:])/g, "$1");
}

function countWordDelta(a, b) {
  const aWords = a.match(/[a-z']+/g) || [];
  const bWords = b.match(/[a-z']+/g) || [];
  const max = Math.max(aWords.length, bWords.length);
  let delta = Math.abs(aWords.length - bWords.length);

  for (let index = 0; index < max; index += 1) {
    if ((aWords[index] || "") !== (bWords[index] || "")) {
      delta += 1;
    }
  }

  return delta;
}

function levenshteinDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let row = 0; row < rows; row += 1) {
    matrix[row][0] = row;
  }

  for (let col = 0; col < cols; col += 1) {
    matrix[0][col] = col;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost
      );
    }
  }

  return matrix[rows - 1][cols - 1];
}

function getVoiceOptions() {
  return window.speechSynthesis.getVoices().slice().sort((a, b) => {
    const aScore = roboticVoiceScore(a);
    const bScore = roboticVoiceScore(b);
    if (aScore !== bScore) {
      return bScore - aScore;
    }
    return a.name.localeCompare(b.name);
  });
}

function roboticVoiceScore(voice) {
  const text = `${voice.name} ${voice.lang}`.toLowerCase();
  let score = 0;
  if (text.includes("compact")) score += 5;
  if (text.includes("samantha")) score -= 2;
  if (text.includes("google us english")) score += 3;
  if (text.includes("zira")) score += 4;
  if (text.includes("david")) score += 2;
  if (text.includes("microsoft")) score += 3;
  if (text.includes("english")) score += 1;
  return score;
}

function populateVoices() {
  appState.voices = getVoiceOptions();
  const previousValue = dom.voiceSelect.value;
  dom.voiceSelect.innerHTML = "";

  if (!appState.voices.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Default system voice";
    dom.voiceSelect.appendChild(option);
    return;
  }

  appState.voices.forEach((voice, index) => {
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    option.textContent = `${index === 0 ? "Recommended: " : ""}${voice.name} (${voice.lang})`;
    dom.voiceSelect.appendChild(option);
  });

  const preferred = appState.voices.find((voice) => roboticVoiceScore(voice) === roboticVoiceScore(appState.voices[0]));
  dom.voiceSelect.value = previousValue || (preferred ? preferred.voiceURI : appState.voices[0].voiceURI);
}

function speakText(text) {
  if (!("speechSynthesis" in window)) {
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const chosenVoice = appState.voices.find((voice) => voice.voiceURI === dom.voiceSelect.value);
  if (chosenVoice) {
    utterance.voice = chosenVoice;
  }
  utterance.rate = Number(dom.rateInput.value);
  utterance.pitch = 0.88;
  window.speechSynthesis.speak(utterance);
}

async function addHistoryEntry(text) {
  const analysis = await scorePhrase(text);
  appState.history.push({
    id: crypto.randomUUID(),
    text,
    analysis,
    createdAt: new Date().toISOString(),
    pendingDelete: false,
  });
  saveHistory();
  renderHistory();
}

function renderHistory() {
  dom.historyList.innerHTML = "";

  if (!appState.history.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No practice entries yet. Type something below and press Enter.";
    dom.historyList.appendChild(empty);
    return;
  }

  appState.history.forEach((entry) => {
    const fragment = dom.template.content.cloneNode(true);
    const article = fragment.querySelector(".history-item");
    const ratingPill = fragment.querySelector(".rating-pill");
    const label = fragment.querySelector(".rating-label");
    const time = fragment.querySelector(".history-time");
    const text = fragment.querySelector(".history-text");
    const feedback = fragment.querySelector(".history-feedback");
    const replayButton = fragment.querySelector(".replay-button");
    const copyButton = fragment.querySelector(".copy-button");
    const deleteButton = fragment.querySelector(".delete-button");

    article.dataset.rating = entry.analysis.rating;
    label.textContent = entry.analysis.label;
    ratingPill.title = entry.analysis.tooltip || entry.analysis.feedback || "";
    ratingPill.setAttribute("aria-label", entry.analysis.tooltip || entry.analysis.feedback || entry.analysis.label);
    time.textContent = new Date(entry.createdAt).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    text.textContent = entry.text;
    feedback.textContent = entry.analysis.feedback || "";

    replayButton.addEventListener("click", () => speakText(entry.text));
    copyButton.addEventListener("click", () => {
      dom.phraseInput.value = entry.text;
      dom.phraseInput.focus();
    });
    if (entry.pendingDelete) {
      deleteButton.classList.add("is-danger");
      deleteButton.title = "Delete forever";
      deleteButton.setAttribute("aria-label", "Delete forever");
      deleteButton.textContent = "✕";
    } else {
      deleteButton.title = "Trash";
      deleteButton.setAttribute("aria-label", "Trash");
      deleteButton.textContent = "🗑";
    }
    deleteButton.addEventListener("click", () => handleDelete(entry.id));

    dom.historyList.appendChild(fragment);
  });
}

function handleDelete(id) {
  appState.history = appState.history
    .map((entry) => {
      if (entry.id !== id) {
        return entry;
      }

      if (entry.pendingDelete) {
        return null;
      }

      return { ...entry, pendingDelete: true };
    })
    .filter(Boolean);

  saveHistory();
  renderHistory();
}

function clearHistory() {
  appState.history = [];
  saveHistory();
  renderHistory();
}

function setMode(mode) {
  appState.mode = mode;
  dom.conversationToggle.checked = mode === "on";
  dom.modeDescription.textContent = modeDescriptions[mode];
}

dom.entryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = dom.phraseInput.value.trim();
  if (!text || appState.isSubmitting) {
    dom.phraseInput.focus();
    return;
  }

  setSubmitting(true);
  try {
    speakText(text);
    await addHistoryEntry(text);
    dom.phraseInput.value = "";
  } finally {
    setSubmitting(false);
    dom.phraseInput.focus();
  }
});

dom.phraseInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    dom.entryForm.requestSubmit();
  }
});

dom.conversationToggle.addEventListener("change", (event) => {
  setMode(event.target.checked ? "on" : "off");
});

dom.clearHistoryButton.addEventListener("click", clearHistory);
dom.retryModelButton.addEventListener("click", () => {
  appState.checker.generator = null;
  appState.checker.loadPromise = null;
  appState.checker.lastError = "";
  ensureGrammarModel();
});

window.speechSynthesis.onvoiceschanged = populateVoices;
populateVoices();
setMode(appState.mode);
renderHistory();
ensureGrammarModel();
