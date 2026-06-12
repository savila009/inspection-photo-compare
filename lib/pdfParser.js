/**
 * PDF text extraction, embedded photo extraction, and inspection-date parsing.
 */

const PDFJS_VERSION = "3.11.174";
const PDFJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

const MIN_PHOTO_WIDTH = 120;
const MIN_PHOTO_HEIGHT = 120;
const MIN_PHOTO_PIXELS = 120 * 120;

const MONTH_NAMES = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const AREA_PATTERNS = [
  [/kitchen/, "Kitchen"],
  [/bath(room)?/, "Bathroom"],
  [/living\s*room|living\s*area/, "Living room"],
  [/bed(room)?\s*1|bedroom\s*one|primary\s*(bed(room)?|suite)/, "Bedroom 1"],
  [/bed(room)?\s*2/, "Bedroom 2"],
  [/bed(room)?\s*3/, "Bedroom 3"],
  [/hall(way)?/, "Hallway"],
  [/dining(\s*room)?/, "Dining room"],
  [/laundry/, "Laundry"],
  [/garage/, "Garage"],
  [/exterior|outside|front\s*yard|back\s*yard|patio|balcony/, "Exterior"],
];

const MOVE_IN_LABELS =
  /move[\s-]?in|check[\s-]?in|initial\s+inspection|pre[\s-]?occupancy|entry\s+inspection|move[\s-]?in\s+inspection|tenant\s+move[\s-]?in/i;
const MOVE_OUT_LABELS =
  /move[\s-]?out|check[\s-]?out|final\s+inspection|exit\s+inspection|move[\s-]?out\s+inspection|vacate|vacancy\s+inspection|departure\s+inspection/i;
const GENERIC_INSPECTION_LABELS =
  /inspection\s+date|date\s+of\s+inspection|report\s+date|completed\s+on|conducted\s+on|inspected\s+on|walk[\s-]?through\s+date|condition\s+report\s+date/i;

export function isPdfFile(file) {
  return (
    file &&
    (file.type === "application/pdf" || String(file.name || "").toLowerCase().endsWith(".pdf"))
  );
}

export async function ensurePdfJs() {
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
    return window.pdfjsLib;
  }
  throw new Error("PDF.js failed to load. Check your internet connection and reload.");
}

export async function loadPdfDocument(file) {
  const pdfjsLib = await ensurePdfJs();
  const buffer = await file.arrayBuffer();
  return pdfjsLib.getDocument({ data: buffer }).promise;
}

/**
 * @param {File} file
 * @param {"moveIn"|"moveOut"} side
 * @param {(message: string) => void} [onProgress]
 */
export async function parseInspectionPdf(file, side, onProgress) {
  const pdfjsLib = await ensurePdfJs();
  const pdf = await loadPdfDocument(file);
  const pageCount = pdf.numPages;
  const pageTexts = [];
  const extractedPhotos = [];
  const baseName = file.name.replace(/\.pdf$/i, "");

  for (let pageNum = 1; pageNum <= pageCount; pageNum += 1) {
    onProgress?.(`Extracting photos from page ${pageNum} of ${pageCount}…`);
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContentToLines(textContent).join("\n");
    pageTexts.push(pageText);

    const pagePhotos = await extractEmbeddedPhotosFromPage(page, pdfjsLib, pageNum, baseName);
    const areas = guessAreasForPagePhotos(pageText, pagePhotos.length);

    pagePhotos.forEach((photo, index) => {
      extractedPhotos.push({
        ...photo,
        pageText,
        area: areas[index] || guessAreaFromPageText(pageText),
      });
    });
  }

  if (!extractedPhotos.length) {
    onProgress?.("No embedded photos found — using page render fallback…");
    for (let pageNum = 1; pageNum <= pageCount; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      const pageText = pageTexts[pageNum - 1] || "";
      const fallbackFile = await renderPageAsPhoto(page, pageNum, baseName);
      if (fallbackFile) {
        extractedPhotos.push({
          file: fallbackFile,
          pageNum,
          source: "page-render",
          pageText,
          area: guessAreaFromPageText(pageText),
        });
      }
    }
  }

  const fullText = normalizeText(pageTexts.join("\n\n"));
  const metadata = await pdf.getMetadata().catch(() => null);
  const metadataDate = parsePdfMetadataDate(metadata?.info);
  const dateResult = parseInspectionDate(fullText, side, metadataDate);

  return {
    text: fullText,
    date: dateResult,
    photos: extractedPhotos,
    pageCount,
    photoCount: extractedPhotos.length,
  };
}

/**
 * Pull embedded XObject / inline images from a PDF page (inspection report photos).
 */
async function extractEmbeddedPhotosFromPage(page, pdfjsLib, pageNum, baseName) {
  const ops = await page.getOperatorList();
  const { fnArray, argsArray } = ops;
  const seen = new Set();
  const photos = [];
  let photoIndex = 0;

  for (let i = 0; i < fnArray.length; i += 1) {
    const op = fnArray[i];
    const args = argsArray[i];

    if (op === pdfjsLib.OPS.paintImageXObject) {
      const name = args[0];
      const key = `x:${name}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const image = await resolvePdfImage(page, name);
      const file = await pdfImageToFile(image, `${baseName}-p${pageNum}-photo-${++photoIndex}`);
      if (file) {
        photos.push({ file, pageNum, source: "embedded" });
      }
      continue;
    }

    if (op === pdfjsLib.OPS.paintInlineImageXObject) {
      const key = `inline:${i}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const image = args[0];
      const file = await pdfImageToFile(image, `${baseName}-p${pageNum}-inline-${++photoIndex}`);
      if (file) {
        photos.push({ file, pageNum, source: "inline" });
      }
    }
  }

  return photos;
}

async function renderPageAsPhoto(page, pageNum, baseName) {
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) {
    return null;
  }

  return new File([blob], `${baseName}-page-${pageNum}.jpg`, { type: "image/jpeg" });
}

async function resolvePdfImage(page, name) {
  try {
    return await page.objs.get(name);
  } catch {
    return page.commonObjs.get(name);
  }
}

async function pdfImageToFile(image, baseName) {
  if (!image || !image.width || !image.height) {
    return null;
  }

  if (
    image.width < MIN_PHOTO_WIDTH ||
    image.height < MIN_PHOTO_HEIGHT ||
    image.width * image.height < MIN_PHOTO_PIXELS
  ) {
    return null;
  }

  const canvas = pdfImageToCanvas(image);
  if (!canvas) {
    return null;
  }

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) {
    return null;
  }

  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
}

function pdfImageToCanvas(image) {
  const pdfjsLib = window.pdfjsLib;
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  const imgData = ctx.createImageData(image.width, image.height);

  if (image.kind === pdfjsLib.ImageKind.RGBA_32BPP) {
    imgData.data.set(image.data);
  } else if (image.kind === pdfjsLib.ImageKind.RGB_24BPP) {
    const src = image.data;
    const dest = imgData.data;
    for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
      dest[j] = src[i];
      dest[j + 1] = src[i + 1];
      dest[j + 2] = src[i + 2];
      dest[j + 3] = 255;
    }
  } else if (image.kind === pdfjsLib.ImageKind.GRAYSCALE_1BPP) {
    const src = image.data;
    const dest = imgData.data;
    const length = image.width * image.height;
    for (let i = 0; i < length; i += 1) {
      const byteIndex = i >> 3;
      const bitIndex = 7 - (i & 7);
      const bit = (src[byteIndex] >> bitIndex) & 1;
      const value = bit ? 0 : 255;
      const offset = i * 4;
      dest[offset] = value;
      dest[offset + 1] = value;
      dest[offset + 2] = value;
      dest[offset + 3] = 255;
    }
  } else {
    return null;
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/**
 * Match area labels from page text to extracted photos on the same page.
 */
export function guessAreasForPagePhotos(pageText, photoCount) {
  if (!photoCount) {
    return [];
  }

  const lines = pageText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const areasFromLines = [];

  for (const line of lines) {
    const area = matchAreaInText(line);
    if (area) {
      areasFromLines.push(area);
    }
  }

  const uniqueAreas = [...new Set(areasFromLines)];
  if (uniqueAreas.length >= photoCount) {
    return uniqueAreas.slice(0, photoCount);
  }

  if (uniqueAreas.length === 1 && photoCount > 0) {
    return Array(photoCount).fill(uniqueAreas[0]);
  }

  const fallback = guessAreaFromPageText(pageText);
  return Array(photoCount).fill(fallback);
}

function matchAreaInText(text) {
  const lower = text.toLowerCase();
  for (const [pattern, area] of AREA_PATTERNS) {
    if (pattern.test(lower)) {
      return area;
    }
  }
  return null;
}

export function guessAreaFromPageText(pageText, fileName = "") {
  const combined = `${pageText}\n${fileName}`.toLowerCase();
  for (const [pattern, area] of AREA_PATTERNS) {
    if (pattern.test(combined)) {
      return area;
    }
  }
  return "Kitchen";
}

/**
 * @param {string} text
 * @param {"moveIn"|"moveOut"} side
 * @param {Date|null} metadataDate
 */
export function parseInspectionDate(text, side, metadataDate = null) {
  const normalized = normalizeText(text);
  const candidates = [];

  collectLabeledDates(normalized, side, candidates);
  collectLabeledDates(normalized, side === "moveIn" ? "moveOut" : "moveIn", candidates, 0.35);
  collectGenericInspectionDates(normalized, candidates);
  collectInlineDates(normalized, candidates, 0.25);

  if (metadataDate) {
    candidates.push({
      date: metadataDate,
      iso: toIsoDate(metadataDate),
      source: "PDF metadata",
      confidence: 0.3,
    });
  }

  const ranked = candidates
    .filter((item) => item.iso && isPlausibleInspectionDate(item.date))
    .sort((a, b) => b.confidence - a.confidence);

  if (!ranked.length) {
    return { iso: null, source: null, confidence: 0, raw: null };
  }

  const best = ranked[0];
  return {
    iso: best.iso,
    source: best.source,
    confidence: best.confidence,
    raw: best.raw,
  };
}

function collectLabeledDates(text, side, candidates, confidenceMultiplier = 1) {
  const sidePattern = side === "moveIn" ? MOVE_IN_LABELS : MOVE_OUT_LABELS;
  const lines = text.split(/\n+/);

  for (const line of lines) {
    if (!sidePattern.test(line)) {
      continue;
    }
    const parsed = parseFirstDateInString(line);
    if (parsed) {
      candidates.push({
        ...parsed,
        source: side === "moveIn" ? "Move-in label in PDF" : "Move-out label in PDF",
        confidence: 0.95 * confidenceMultiplier,
      });
    }
  }

  const blockPattern = new RegExp(
    `${sidePattern.source}[^\\n]{0,40}?(${DATE_FRAGMENT.source})`,
    "gi"
  );
  for (const match of text.matchAll(blockPattern)) {
    const parsed = parseDateToken(match[1]);
    if (parsed) {
      candidates.push({
        ...parsed,
        source: side === "moveIn" ? "Move-in label in PDF" : "Move-out label in PDF",
        confidence: 0.9 * confidenceMultiplier,
      });
    }
  }
}

function collectGenericInspectionDates(text, candidates) {
  const lines = text.split(/\n+/);
  for (const line of lines) {
    if (!GENERIC_INSPECTION_LABELS.test(line)) {
      continue;
    }
    const parsed = parseFirstDateInString(line);
    if (parsed) {
      candidates.push({
        ...parsed,
        source: "Inspection date label in PDF",
        confidence: 0.85,
      });
    }
  }

  for (const match of text.matchAll(
    new RegExp(`${GENERIC_INSPECTION_LABELS.source}[^\\n]{0,30}?(${DATE_FRAGMENT.source})`, "gi")
  )) {
    const parsed = parseDateToken(match[1]);
    if (parsed) {
      candidates.push({
        ...parsed,
        source: "Inspection date label in PDF",
        confidence: 0.8,
      });
    }
  }
}

function collectInlineDates(text, candidates, confidence) {
  for (const match of text.matchAll(DATE_FRAGMENT)) {
    const parsed = parseDateToken(match[0]);
    if (parsed) {
      candidates.push({
        ...parsed,
        source: "Date found in PDF text",
        confidence,
      });
    }
  }
}

const DATE_FRAGMENT =
  /(?:20\d{2}-[01]\d-[0-3]\d|(?:0?[1-9]|1[0-2])[\/\-](?:0?[1-9]|[12]\d|3[01])[\/\-](?:20)?\d{2}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+[0-3]?\d(?:st|nd|rd|th)?,?\s+20\d{2})/gi;

function parseFirstDateInString(value) {
  const match = value.match(DATE_FRAGMENT);
  if (!match) {
    return null;
  }
  return parseDateToken(match[0]);
}

function parseDateToken(token) {
  const raw = String(token || "").trim();
  if (!raw) {
    return null;
  }

  const isoMatch = raw.match(/^(20\d{2})-([01]\d)-([0-3]\d)$/);
  if (isoMatch) {
    const date = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    return { date, iso: toIsoDate(date), raw };
  }

  const slashMatch = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slashMatch) {
    let year = Number(slashMatch[3]);
    if (year < 100) {
      year += 2000;
    }
    const month = Number(slashMatch[1]);
    const day = Number(slashMatch[2]);
    const date = new Date(year, month - 1, day);
    if (isValidDateParts(year, month, day)) {
      return { date, iso: toIsoDate(date), raw };
    }
  }

  const namedMatch = raw.match(
    /^([A-Za-z]+)\.?\s+([0-3]?\d)(?:st|nd|rd|th)?,?\s+(20\d{2})$/i
  );
  if (namedMatch) {
    const month = MONTH_NAMES[namedMatch[1].toLowerCase()];
    const day = Number(namedMatch[2]);
    const year = Number(namedMatch[3]);
    if (month && isValidDateParts(year, month, day)) {
      const date = new Date(year, month - 1, day);
      return { date, iso: toIsoDate(date), raw };
    }
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime()) && isPlausibleInspectionDate(parsed)) {
    return { date: parsed, iso: toIsoDate(parsed), raw };
  }

  return null;
}

function parsePdfMetadataDate(info) {
  if (!info) {
    return null;
  }
  const raw = info.CreationDate || info.ModDate;
  if (!raw || typeof raw !== "string") {
    return null;
  }

  const match = raw.match(/^D:(20\d{2})([01]\d)([0-3]\d)/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidDateParts(year, month, day)) {
    return null;
  }
  return new Date(year, month - 1, day);
}

function isValidDateParts(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function isPlausibleInspectionDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return false;
  }
  const year = date.getFullYear();
  const now = new Date();
  return year >= 1990 && date <= new Date(now.getFullYear() + 1, 11, 31);
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function textContentToLines(textContent) {
  const buckets = new Map();
  const items = textContent.items || [];
  for (const item of items) {
    const yRaw = item.transform && item.transform[5];
    const y = Number.isFinite(yRaw) ? Math.round(yRaw * 10) / 10 : 0;
    const existing = buckets.get(y) || [];
    existing.push(item);
    buckets.set(y, existing);
  }

  const sortedY = [...buckets.keys()].sort((a, b) => b - a);
  return sortedY
    .map((y) => {
      const lineItems = buckets.get(y) || [];
      lineItems.sort((a, b) => (a.transform?.[4] || 0) - (b.transform?.[4] || 0));
      return lineItems.map((item) => String(item.str || "")).join(" ").replace(/\s+/g, " ").trim();
    })
    .filter(Boolean);
}

function normalizeText(text) {
  return (text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
