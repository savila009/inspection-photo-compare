import {
  AREA_OPTIONS,
  classifyDamage,
  formatTenancySummary,
  getTenancyDuration,
  inferItemKey,
} from "./lib/wearAndTear.js";
import { compareImages, fileToBase64, loadImageFromFile } from "./lib/imageCompare.js";
import { analyzeWithVision, checkServerAvailable } from "./lib/visionAnalysis.js";
import {
  isPdfFile,
  parseInspectionPdf,
} from "./lib/pdfParser.js";

const state = {
  moveIn: [],
  moveOut: [],
  serverAvailable: false,
};

let photoIdCounter = 0;

const moveInDateEl = document.getElementById("moveInDate");
const moveOutDateEl = document.getElementById("moveOutDate");
const moveInDateSourceEl = document.getElementById("moveInDateSource");
const moveOutDateSourceEl = document.getElementById("moveOutDateSource");
const tenancySummaryEl = document.getElementById("tenancySummary");
const apiKeyEl = document.getElementById("apiKey");
const serverStatusEl = document.getElementById("serverStatus");
const moveInDropzone = document.getElementById("moveInDropzone");
const moveOutDropzone = document.getElementById("moveOutDropzone");
const moveInFilesEl = document.getElementById("moveInFiles");
const moveOutFilesEl = document.getElementById("moveOutFiles");
const moveInGridEl = document.getElementById("moveInGrid");
const moveOutGridEl = document.getElementById("moveOutGrid");
const moveInUploadStatusEl = document.getElementById("moveInUploadStatus");
const moveOutUploadStatusEl = document.getElementById("moveOutUploadStatus");
const analyzeBtn = document.getElementById("analyzeBtn");
const clearBtn = document.getElementById("clearBtn");
const analyzeStatusEl = document.getElementById("analyzeStatus");
const resultsCardEl = document.getElementById("resultsCard");
const resultsSummaryEl = document.getElementById("resultsSummary");
const comparisonResultsEl = document.getElementById("comparisonResults");
const photoCardTemplate = document.getElementById("photoCardTemplate");

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

function init() {
  if (window.location.protocol === "file:") {
    showStartupError(
      "This app must be run from a local web server (not opened as a file). Run: npm start or python3 -m http.server 8080"
    );
    return;
  }

  if (!moveInDropzone || !moveOutDropzone || !moveInFilesEl || !moveOutFilesEl) {
    console.error("Inspection compare: upload UI failed to initialize.");
    return;
  }

  preventBrowserFileDrop();
  setupDropzone(moveInDropzone, moveInFilesEl, "moveIn");
  setupDropzone(moveOutDropzone, moveOutFilesEl, "moveOut");

  moveInDateEl.addEventListener("change", updateTenancySummary);
  moveOutDateEl.addEventListener("change", updateTenancySummary);
  analyzeBtn.addEventListener("click", runAnalysis);
  clearBtn.addEventListener("click", clearAll);

  checkServerAvailable().then((available) => {
    state.serverAvailable = available;
    if (available) {
      serverStatusEl.textContent = "Local analysis server is running. AI vision is available.";
      serverStatusEl.className = "status status--ok";
    } else {
      serverStatusEl.textContent =
        "Local server not detected. Run npm start for AI descriptions; pixel comparison still works.";
      serverStatusEl.className = "status muted";
    }
  });

  updateAnalyzeButton();
}

function preventBrowserFileDrop() {
  document.addEventListener(
    "dragover",
    (event) => {
      if (event.dataTransfer?.types?.includes("Files")) {
        event.preventDefault();
      }
    },
    false
  );

  document.addEventListener(
    "drop",
    (event) => {
      if (!event.target.closest(".upload-panel")) {
        event.preventDefault();
      }
    },
    false
  );
}

function setupDropzone(dropzone, input, side) {
  const panel = dropzone.closest(".upload-panel");
  const dropTarget = panel || dropzone;
  let dragDepth = 0;

  dropzone.addEventListener("click", (event) => {
    event.preventDefault();
    input.click();
  });

  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  });

  dropTarget.addEventListener("dragenter", (event) => {
    if (!isFileDrag(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragDepth += 1;
    dropzone.classList.add("dropzone--active");
  });

  dropTarget.addEventListener("dragleave", (event) => {
    if (!isFileDrag(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragDepth -= 1;
    if (dragDepth <= 0) {
      dragDepth = 0;
      dropzone.classList.remove("dropzone--active");
    }
  });

  dropTarget.addEventListener("dragover", (event) => {
    if (!isFileDrag(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  });

  dropTarget.addEventListener("drop", (event) => {
    if (!isFileDrag(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragDepth = 0;
    dropzone.classList.remove("dropzone--active");

    const files = event.dataTransfer?.files;
    if (!files?.length) {
      return;
    }

    const fileList = Array.from(files);
    const pdfFile = fileList.find(isPdfFile);
    if (pdfFile) {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(pdfFile);
      input.files = dataTransfer.files;
    }

    void handleFiles(side, fileList);
  });

  input.addEventListener("change", () => {
    if (input.files?.length) {
      void handleFiles(side, Array.from(input.files));
      input.value = "";
    }
  });
}

function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function showStartupError(message) {
  const banner = document.createElement("p");
  banner.className = "status status--error";
  banner.setAttribute("role", "alert");
  banner.textContent = message;
  document.querySelector(".page-header")?.append(banner);
}

async function handleFiles(side, files) {
  if (!files.length) {
    return;
  }

  const statusEl = side === "moveIn" ? moveInUploadStatusEl : moveOutUploadStatusEl;
  const pdfFiles = files.filter(isPdfFile);

  if (!pdfFiles.length) {
    statusEl.textContent = "Upload an inspection report PDF. Individual photo files are not used.";
    statusEl.className = "status status--error";
    return;
  }

  if (pdfFiles.length > 1) {
    statusEl.textContent = "Upload one inspection PDF at a time for each side.";
    statusEl.className = "status status--warn";
  }

  try {
    clearSidePhotos(side);

    const pdfFile = pdfFiles[0];
    statusEl.textContent = `Reading ${pdfFile.name}…`;
    statusEl.className = "status muted";

    const parsed = await parseInspectionPdf(pdfFile, side, (message) => {
      statusEl.textContent = message;
    });

    applyParsedInspectionDate(side, parsed.date, pdfFile.name);

    if (!parsed.photoCount) {
      statusEl.textContent =
        `No photos found embedded in ${pdfFile.name}. The report may use a format this tool cannot extract yet.`;
      statusEl.className = "status status--error";
      updateAnalyzeButton();
      return;
    }

    for (const photo of parsed.photos) {
      addPhotoRecord(side, photo.file, photo.area);
    }

    if (parsed.date.iso) {
      statusEl.textContent = `Extracted ${parsed.photoCount} photo${parsed.photoCount === 1 ? "" : "s"} from ${parsed.pageCount} page${parsed.pageCount === 1 ? "" : "s"}. Inspection date set to ${parsed.date.iso}.`;
      statusEl.className = "status status--ok";
    } else {
      statusEl.textContent = `Extracted ${parsed.photoCount} photo${parsed.photoCount === 1 ? "" : "s"} from ${pdfFile.name}. Could not find an inspection date — enter it manually above.`;
      statusEl.className = "status status--warn";
    }
  } catch (err) {
    statusEl.textContent = err.message || "Failed to read uploaded PDF.";
    statusEl.className = "status status--error";
  }

  updateAnalyzeButton();
}

function clearSidePhotos(side) {
  const list = side === "moveIn" ? state.moveIn : state.moveOut;
  const grid = side === "moveIn" ? moveInGridEl : moveOutGridEl;

  for (const photo of list) {
    URL.revokeObjectURL(photo.url);
  }
  list.length = 0;
  grid.innerHTML = "";
}

function applyParsedInspectionDate(side, dateResult, fileName) {
  const dateEl = side === "moveIn" ? moveInDateEl : moveOutDateEl;
  const sourceEl = side === "moveIn" ? moveInDateSourceEl : moveOutDateSourceEl;

  if (dateResult?.iso) {
    dateEl.value = dateResult.iso;
    sourceEl.textContent = `From ${fileName}: ${dateResult.source}${dateResult.raw ? ` (${dateResult.raw})` : ""}`;
    sourceEl.className = "field-note field-note--ok";
    updateTenancySummary();
    return;
  }

  sourceEl.textContent = `Could not parse an inspection date from ${fileName}. Enter the date manually.`;
  sourceEl.className = "field-note field-note--warn";
}

function addPhotoRecord(side, file, area) {
  const list = side === "moveIn" ? state.moveIn : state.moveOut;
  const grid = side === "moveIn" ? moveInGridEl : moveOutGridEl;
  const id = `photo-${++photoIdCounter}`;
  const url = URL.createObjectURL(file);
  const photo = {
    id,
    file,
    url,
    area,
    side,
  };
  list.push(photo);
  grid.appendChild(createPhotoCard(photo));
}

function createPhotoCard(photo) {
  const node = photoCardTemplate.content.cloneNode(true);
  const card = node.querySelector(".photo-card");
  card.dataset.photoId = photo.id;

  const img = node.querySelector(".photo-thumb");
  img.src = photo.url;
  img.alt = photo.file.name;

  const select = node.querySelector(".area-select");
  for (const option of AREA_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = option;
    opt.textContent = option;
    if (option === photo.area) {
      opt.selected = true;
    }
    select.appendChild(opt);
  }

  const customInput = node.querySelector(".custom-area");
  select.addEventListener("change", () => {
    if (select.value === "Other (custom)") {
      customInput.hidden = false;
      photo.area = customInput.value.trim() || "Custom area";
    } else {
      customInput.hidden = true;
      photo.area = select.value;
    }
    updateAnalyzeButton();
  });

  customInput.addEventListener("input", () => {
    photo.area = customInput.value.trim() || "Custom area";
    updateAnalyzeButton();
  });

  node.querySelector(".remove-photo").addEventListener("click", () => {
    removePhoto(photo);
  });

  return node;
}

function removePhoto(photo) {
  const list = photo.side === "moveIn" ? state.moveIn : state.moveOut;
  const index = list.findIndex((item) => item.id === photo.id);
  if (index === -1) {
    return;
  }
  URL.revokeObjectURL(photo.url);
  list.splice(index, 1);
  const grid = photo.side === "moveIn" ? moveInGridEl : moveOutGridEl;
  const card = grid.querySelector(`[data-photo-id="${photo.id}"]`);
  card?.remove();
  updateAnalyzeButton();
}

function clearAll() {
  for (const photo of [...state.moveIn, ...state.moveOut]) {
    URL.revokeObjectURL(photo.url);
  }
  state.moveIn = [];
  state.moveOut = [];
  moveInGridEl.innerHTML = "";
  moveOutGridEl.innerHTML = "";
  moveInUploadStatusEl.textContent = "";
  moveOutUploadStatusEl.textContent = "";
  moveInDateSourceEl.textContent = "";
  moveOutDateSourceEl.textContent = "";
  moveInDateSourceEl.className = "field-note";
  moveOutDateSourceEl.className = "field-note";
  resultsCardEl.classList.add("hidden");
  comparisonResultsEl.innerHTML = "";
  resultsSummaryEl.innerHTML = "";
  analyzeStatusEl.textContent = "";
  updateAnalyzeButton();
}

function getResolvedArea(photo) {
  const card = document.querySelector(`[data-photo-id="${photo.id}"]`);
  const select = card?.querySelector(".area-select");
  if (select?.value === "Other (custom)") {
    const custom = card.querySelector(".custom-area")?.value.trim();
    return custom || "Custom area";
  }
  return select?.value || photo.area;
}

function updateTenancySummary() {
  const moveIn = parseDateInput(moveInDateEl.value);
  const moveOut = parseDateInput(moveOutDateEl.value);
  if (!moveIn || !moveOut) {
    tenancySummaryEl.textContent = "Enter both dates to calculate tenancy length.";
    tenancySummaryEl.className = "status muted";
    updateAnalyzeButton();
    return;
  }
  const duration = getTenancyDuration(moveIn, moveOut);
  tenancySummaryEl.textContent = formatTenancySummary(duration);
  tenancySummaryEl.className = duration ? "status status--ok" : "status status--error";
  updateAnalyzeButton();
}

function parseDateInput(value) {
  if (!value) {
    return null;
  }
  const parts = value.split("-").map(Number);
  if (parts.length !== 3) {
    return null;
  }
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function updateAnalyzeButton() {
  const moveIn = parseDateInput(moveInDateEl.value);
  const moveOut = parseDateInput(moveOutDateEl.value);
  const duration = moveIn && moveOut ? getTenancyDuration(moveIn, moveOut) : null;
  const hasPairs = buildAreaPairs().length > 0;
  analyzeBtn.disabled = !(duration && hasPairs);
}

function normalizeArea(area) {
  return (area || "").trim().toLowerCase();
}

function buildAreaPairs() {
  const moveInByArea = groupByArea(state.moveIn);
  const moveOutByArea = groupByArea(state.moveOut);
  const areas = new Set([...moveInByArea.keys(), ...moveOutByArea.keys()]);
  const pairs = [];

  for (const area of areas) {
    const moveInPhotos = moveInByArea.get(area) || [];
    const moveOutPhotos = moveOutByArea.get(area) || [];
    if (moveInPhotos.length && moveOutPhotos.length) {
      pairs.push({
        area,
        moveIn: moveInPhotos[0],
        moveOut: moveOutPhotos[0],
        extraMoveIn: moveInPhotos.slice(1),
        extraMoveOut: moveOutPhotos.slice(1),
      });
    }
  }

  return pairs.sort((a, b) => a.area.localeCompare(b.area));
}

function groupByArea(photos) {
  const map = new Map();
  for (const photo of photos) {
    const area = normalizeArea(getResolvedArea(photo));
    if (!map.has(area)) {
      map.set(area, []);
    }
    map.get(area).push(photo);
  }
  return map;
}

async function runAnalysis() {
  const moveIn = parseDateInput(moveInDateEl.value);
  const moveOut = parseDateInput(moveOutDateEl.value);
  const duration = getTenancyDuration(moveIn, moveOut);
  if (!duration) {
    analyzeStatusEl.textContent = "Fix inspection dates before analyzing.";
    analyzeStatusEl.className = "status status--error";
    return;
  }

  const pairs = buildAreaPairs();
  if (!pairs.length) {
    analyzeStatusEl.textContent =
      "Add at least one matching area tag on both move-in and move-out photos.";
    analyzeStatusEl.className = "status status--error";
    return;
  }

  analyzeBtn.disabled = true;
  analyzeStatusEl.textContent = `Analyzing ${pairs.length} area comparison${pairs.length === 1 ? "" : "s"}…`;
  analyzeStatusEl.className = "status muted";

  const apiKey = apiKeyEl.value.trim();
  const useVision = state.serverAvailable && apiKey.length > 0;
  const results = [];

  for (const pair of pairs) {
    try {
      const result = await analyzePair(pair, duration.years, apiKey, useVision);
      results.push(result);
    } catch (err) {
      results.push({
        area: pair.area,
        error: err.message || "Analysis failed",
      });
    }
  }

  renderResults(results, duration);
  analyzeBtn.disabled = false;
  analyzeStatusEl.textContent = "Analysis complete.";
  analyzeStatusEl.className = "status status--ok";
}

async function analyzePair(pair, tenancyYears, apiKey, useVision) {
  const moveInImg = await loadImageFromFile(pair.moveIn.file);
  const moveOutImg = await loadImageFromFile(pair.moveOut.file);
  const pixelCompare = await compareImages(moveInImg, moveOutImg);

  let visionFindings = [];
  if (useVision) {
    const [moveInBase64, moveOutBase64] = await Promise.all([
      fileToBase64(pair.moveIn.file),
      fileToBase64(pair.moveOut.file),
    ]);
    const vision = await analyzeWithVision({
      moveInBase64,
      moveOutBase64,
      area: pair.area,
      tenancyYears,
      apiKey,
    });
    visionFindings = vision.findings || [];
  } else {
    visionFindings = buildHeuristicFindings(pixelCompare, pair.area);
  }

  const classifiedFindings = visionFindings.map((finding) => {
    const itemKey = finding.itemKey || inferItemKey(finding.description);
    const severity = finding.severity ?? pixelCompare.severityScore;
    const wearResult = classifyDamage(severity, itemKey, tenancyYears);
    return { ...finding, itemKey, severity, wearResult };
  });

  const chargeableCount = classifiedFindings.filter((f) => f.wearResult.chargeable).length;
  const overallBadge =
    chargeableCount > 0 ? "damage" : classifiedFindings.length ? "wear" : "review";

  return {
    area: pair.area,
    moveInUrl: pair.moveIn.url,
    moveOutUrl: pair.moveOut.url,
    moveInName: pair.moveIn.file.name,
    moveOutName: pair.moveOut.file.name,
    pixelCompare,
    findings: classifiedFindings,
    chargeableCount,
    overallBadge,
    extraNote:
      pair.extraMoveIn.length || pair.extraMoveOut.length
        ? `Additional unmatched photos in this area: ${pair.extraMoveIn.length} move-in, ${pair.extraMoveOut.length} move-out (only first pair compared).`
        : null,
  };
}

function buildHeuristicFindings(pixelCompare, area) {
  if (pixelCompare.changedAreaPercent < 1.5) {
    return [
      {
        title: "Minimal visible change",
        description: `Pixel comparison shows ~${pixelCompare.changedAreaPercent.toFixed(1)}% changed area between move-in and move-out for ${area}.`,
        severity: pixelCompare.severityScore,
      },
    ];
  }

  return [
    {
      title: "Visible change detected",
      description: `Approximately ${pixelCompare.changedAreaPercent.toFixed(1)}% of the image differs from move-in. Review the heatmap and classify the affected surface (wall, floor, fixture, etc.).`,
      severity: pixelCompare.severityScore,
    },
  ];
}

function renderResults(results, duration) {
  resultsCardEl.classList.remove("hidden");

  const totalChargeable = results.reduce((sum, r) => sum + (r.chargeableCount || 0), 0);
  const areasWithDamage = results.filter((r) => r.chargeableCount > 0).length;
  const areasCompared = results.filter((r) => !r.error).length;

  resultsSummaryEl.innerHTML = `
    <div class="stat-box">
      <span class="label">Areas compared</span>
      <span class="value">${areasCompared}</span>
    </div>
    <div class="stat-box">
      <span class="label">Tenancy</span>
      <span class="value" style="font-size:1rem">${Math.round(duration.months)} mo</span>
    </div>
    <div class="stat-box">
      <span class="label">Chargeable findings</span>
      <span class="value ${totalChargeable ? "danger" : "success"}">${totalChargeable}</span>
    </div>
    <div class="stat-box">
      <span class="label">Areas w/ damage</span>
      <span class="value ${areasWithDamage ? "danger" : "success"}">${areasWithDamage}</span>
    </div>
  `;

  comparisonResultsEl.innerHTML = results
    .map((result) => renderComparisonCard(result))
    .join("");
}

function renderComparisonCard(result) {
  if (result.error) {
    return `
      <article class="comparison-card">
        <div class="comparison-header">
          <h3>${escapeHtml(result.area)}</h3>
          <span class="badge badge--review">Error</span>
        </div>
        <div class="comparison-body">
          <p class="no-findings">${escapeHtml(result.error)}</p>
        </div>
      </article>
    `;
  }

  const badgeClass =
    result.overallBadge === "damage"
      ? "badge--damage"
      : result.overallBadge === "wear"
        ? "badge--wear"
        : "badge--review";
  const badgeLabel =
    result.overallBadge === "damage"
      ? "Possible tenant damage"
      : result.overallBadge === "wear"
        ? "Likely wear & tear"
        : "Review manually";

  const findingsHtml = result.findings.length
    ? `<ul class="finding-list">${result.findings.map(renderFinding).join("")}</ul>`
    : `<p class="no-findings">No significant differences detected.</p>`;

  return `
    <article class="comparison-card">
      <div class="comparison-header">
        <h3>${escapeHtml(capitalizeArea(result.area))}</h3>
        <span class="badge ${badgeClass}">${badgeLabel}</span>
      </div>
      <div class="comparison-images">
        <div class="image-panel">
          <img src="${result.moveInUrl}" alt="Move-in: ${escapeHtml(result.moveInName)}" />
          <div class="caption">Move-in · ${escapeHtml(result.moveInName)}</div>
        </div>
        <div class="image-panel">
          <img src="${result.moveOutUrl}" alt="Move-out: ${escapeHtml(result.moveOutName)}" />
          <div class="caption">Move-out · ${escapeHtml(result.moveOutName)}</div>
        </div>
        <div class="image-panel">
          <img src="${result.pixelCompare.heatmapDataUrl}" alt="Difference heatmap" />
          <div class="caption">Change heatmap · ${result.pixelCompare.changedAreaPercent.toFixed(1)}% changed</div>
        </div>
      </div>
      <div class="comparison-body">
        ${findingsHtml}
        ${result.extraNote ? `<p class="hint">${escapeHtml(result.extraNote)}</p>` : ""}
      </div>
    </article>
  `;
}

function renderFinding(finding) {
  const wear = finding.wearResult;
  const badgeClass = wear.chargeable ? "badge--damage" : "badge--wear";
  const badgeText = wear.chargeable ? "Chargeable" : "Wear & tear";

  return `
    <li>
      <div class="finding-title">${escapeHtml(finding.title || finding.description || "Finding")}</div>
      <div class="finding-detail">${escapeHtml(finding.description || "")}</div>
      ${finding.rationale ? `<div class="finding-detail">${escapeHtml(finding.rationale)}</div>` : ""}
      <div class="finding-detail">${escapeHtml(wear.rationale)}</div>
      <div class="finding-meta">
        <span class="badge ${badgeClass}">${badgeText}</span>
        <span>${escapeHtml(wear.itemLabel)} · useful life ~${wear.lifespanYears} yrs</span>
        <span>Severity ${finding.severity.toFixed(0)}% · expected wear ${wear.expectedWearPercent.toFixed(0)}%</span>
      </div>
      <div class="wear-bar" title="Expected wear vs observed severity">
        <div class="wear-bar-fill wear-bar-fill--expected" style="width:${wear.expectedWearPercent}%"></div>
      </div>
      <div class="wear-bar">
        <div class="wear-bar-fill wear-bar-fill--observed" style="width:${Math.min(finding.severity, 100)}%"></div>
      </div>
    </li>
  `;
}

function capitalizeArea(area) {
  return area.replace(/\b\w/g, (char) => char.toUpperCase());
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
