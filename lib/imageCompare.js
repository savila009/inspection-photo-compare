/**
 * Resize and compare two images on canvas; return diff metrics, heatmap, and highlighted evidence.
 * @param {HTMLImageElement} moveInImg
 * @param {HTMLImageElement} moveOutImg
 * @param {number} [maxSize=640]
 */
export async function compareImages(moveInImg, moveOutImg, maxSize = 640) {
  const { width, height } = fitDimensions(
    moveInImg.naturalWidth,
    moveInImg.naturalHeight,
    moveOutImg.naturalWidth,
    moveOutImg.naturalHeight,
    maxSize
  );

  const canvasA = document.createElement("canvas");
  canvasA.width = width;
  canvasA.height = height;
  const ctxA = canvasA.getContext("2d", { willReadFrequently: true });
  ctxA.drawImage(moveInImg, 0, 0, width, height);
  const dataA = ctxA.getImageData(0, 0, width, height).data;

  const canvasB = document.createElement("canvas");
  canvasB.width = width;
  canvasB.height = height;
  const ctxB = canvasB.getContext("2d", { willReadFrequently: true });
  ctxB.drawImage(moveOutImg, 0, 0, width, height);
  const dataB = ctxB.getImageData(0, 0, width, height).data;

  const threshold = 28;
  const diffMask = new Uint8Array(width * height);
  let totalDiff = 0;
  let significantPixels = 0;
  const pixelCount = width * height;

  for (let i = 0; i < dataA.length; i += 4) {
    const dr = Math.abs(dataA[i] - dataB[i]);
    const dg = Math.abs(dataA[i + 1] - dataB[i + 1]);
    const db = Math.abs(dataA[i + 2] - dataB[i + 2]);
    const diff = (dr + dg + db) / 3;
    totalDiff += diff;

    if (diff > threshold) {
      significantPixels += 1;
      diffMask[i / 4] = 1;
    }
  }

  const heatmapDataUrl = buildHeatmapDataUrl(dataA, dataB, width, height, threshold);
  const avgDiff = totalDiff / ((pixelCount * 255) / 3);
  const changedAreaPercent = (significantPixels / pixelCount) * 100;
  const severityScore = Math.min(100, changedAreaPercent * 2.5 + avgDiff * 35);
  const evidence = await buildEvidenceImages(canvasA, canvasB, diffMask, width, height, heatmapDataUrl);

  return {
    severityScore,
    changedAreaPercent,
    avgDiff,
    heatmapDataUrl,
    width,
    height,
    evidence,
  };
}

function buildHeatmapDataUrl(dataA, dataB, width, height, threshold) {
  const heatCanvas = document.createElement("canvas");
  heatCanvas.width = width;
  heatCanvas.height = height;
  const heatCtx = heatCanvas.getContext("2d");
  const heatData = heatCtx.createImageData(width, height);

  for (let i = 0; i < dataA.length; i += 4) {
    const dr = Math.abs(dataA[i] - dataB[i]);
    const dg = Math.abs(dataA[i + 1] - dataB[i + 1]);
    const db = Math.abs(dataA[i + 2] - dataB[i + 2]);
    const diff = (dr + dg + db) / 3;

    if (diff > threshold) {
      const intensity = Math.min(255, diff * 2.2);
      heatData.data[i] = intensity;
      heatData.data[i + 1] = Math.max(0, 180 - intensity * 0.5);
      heatData.data[i + 2] = 0;
      heatData.data[i + 3] = Math.min(220, intensity + 40);
    } else {
      heatData.data[i + 3] = 0;
    }
  }

  heatCtx.putImageData(heatData, 0, 0);
  return heatCanvas.toDataURL("image/png");
}

async function buildEvidenceImages(canvasA, canvasB, diffMask, width, height, heatmapDataUrl) {
  const bounds = findHighlightBounds(diffMask, width, height);
  const moveInHighlightedUrl = renderHighlightedImage(canvasA, diffMask, width, height, bounds, {
    overlay: false,
  });
  const moveOutHighlightedUrl = renderHighlightedImage(canvasB, diffMask, width, height, bounds, {
    overlay: true,
  });
  const combinedUrl = await renderCombinedEvidence(
    moveInHighlightedUrl,
    moveOutHighlightedUrl,
    width,
    height
  );

  return {
    moveInHighlightedUrl,
    moveOutHighlightedUrl,
    combinedUrl,
    heatmapDataUrl,
    hasHighlight: Boolean(bounds),
  };
}

function findHighlightBounds(diffMask, width, height) {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let found = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!diffMask[y * width + x]) {
        continue;
      }
      found = true;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (!found) {
    return null;
  }

  const pad = Math.round(Math.max(width, height) * 0.02);
  const x = Math.max(0, minX - pad);
  const y = Math.max(0, minY - pad);
  return {
    x,
    y,
    w: Math.min(width - x, maxX - minX + 1 + pad * 2),
    h: Math.min(height - y, maxY - minY + 1 + pad * 2),
  };
}

function renderHighlightedImage(sourceCanvas, diffMask, width, height, bounds, { overlay }) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(sourceCanvas, 0, 0);

  if (overlay) {
    const overlayData = ctx.getImageData(0, 0, width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!diffMask[y * width + x]) {
          continue;
        }
        const i = (y * width + x) * 4;
        overlayData.data[i] = Math.min(255, overlayData.data[i] * 0.45 + 255 * 0.55);
        overlayData.data[i + 1] = Math.max(0, overlayData.data[i + 1] * 0.45);
        overlayData.data[i + 2] = Math.max(0, overlayData.data[i + 2] * 0.45);
      }
    }
    ctx.putImageData(overlayData, 0, 0);
  }

  if (bounds) {
    drawHighlightBox(ctx, bounds);
  }

  return canvas.toDataURL("image/jpeg", 0.92);
}

async function renderCombinedEvidence(moveInUrl, moveOutUrl, width, height) {
  const [imgIn, imgOut] = await Promise.all([loadDataUrlImage(moveInUrl), loadDataUrlImage(moveOutUrl)]);

  const labelHeight = 28;
  const gap = 12;
  const combined = document.createElement("canvas");
  combined.width = width * 2 + gap;
  combined.height = height + labelHeight;
  const ctx = combined.getContext("2d");

  ctx.fillStyle = "#111827";
  ctx.fillRect(0, 0, combined.width, combined.height);
  ctx.fillStyle = "#e5e7eb";
  ctx.font = "600 14px system-ui, sans-serif";
  ctx.fillText("Move-in", 8, 18);
  ctx.fillText("Move-out (highlighted)", width + gap + 8, 18);
  ctx.drawImage(imgIn, 0, labelHeight);
  ctx.drawImage(imgOut, width + gap, labelHeight);

  return combined.toDataURL("image/jpeg", 0.92);
}

function loadDataUrlImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load evidence image."));
    img.src = dataUrl;
  });
}

function drawHighlightBox(ctx, bounds) {
  ctx.save();
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 5]);
  ctx.strokeRect(bounds.x + 1.5, bounds.y + 1.5, bounds.w - 3, bounds.h - 3);
  ctx.setLineDash([]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.strokeRect(bounds.x + 1.5, bounds.y + 1.5, bounds.w - 3, bounds.h - 3);
  ctx.restore();
}

function fitDimensions(w1, h1, w2, h2, maxSize) {
  const maxW = Math.max(w1, w2);
  const maxH = Math.max(h1, h2);
  const scale = Math.min(1, maxSize / Math.max(maxW, maxH));
  return {
    width: Math.round(maxW * scale),
    height: Math.round(maxH * scale),
  };
}

export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load image: ${file.name}`));
    };
    img.src = url;
  });
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/**
 * Build downloadable evidence images with AI-provided highlight regions.
 * @param {HTMLImageElement} moveInImg
 * @param {HTMLImageElement} moveOutImg
 * @param {Array<{x:number,y:number,width?:number,height?:number,w?:number,h?:number}>} highlightBoxes
 * @param {number} [maxSize=960]
 */
export async function buildComparisonEvidence(moveInImg, moveOutImg, highlightBoxes = [], maxSize = 960) {
  const { width, height } = fitDimensions(
    moveInImg.naturalWidth,
    moveInImg.naturalHeight,
    moveOutImg.naturalWidth,
    moveOutImg.naturalHeight,
    maxSize
  );

  const canvasA = document.createElement("canvas");
  canvasA.width = width;
  canvasA.height = height;
  canvasA.getContext("2d").drawImage(moveInImg, 0, 0, width, height);

  const canvasB = document.createElement("canvas");
  canvasB.width = width;
  canvasB.height = height;
  canvasB.getContext("2d").drawImage(moveOutImg, 0, 0, width, height);

  const boxes = normalizeHighlightBoxes(highlightBoxes, width, height);
  const moveInHighlightedUrl = renderEvidenceCanvas(canvasA, width, height, boxes, { tintMoveOut: false });
  const moveOutHighlightedUrl = renderEvidenceCanvas(canvasB, width, height, boxes, { tintMoveOut: true });
  const combinedUrl = await renderCombinedEvidence(moveInHighlightedUrl, moveOutHighlightedUrl, width, height);

  return {
    moveInHighlightedUrl,
    moveOutHighlightedUrl,
    combinedUrl,
    heatmapDataUrl: null,
    hasHighlight: boxes.length > 0,
    source: "ai",
  };
}

function normalizeHighlightBoxes(highlightBoxes, width, height) {
  return (highlightBoxes || [])
    .map((box) => {
      const x = Number(box?.x);
      const y = Number(box?.y);
      const w = Number(box?.width ?? box?.w);
      const h = Number(box?.height ?? box?.h);
      if ([x, y, w, h].some((value) => Number.isNaN(value))) {
        return null;
      }
      const px = Math.max(0, Math.min(width, x * width));
      const py = Math.max(0, Math.min(height, y * height));
      const pw = Math.max(0, Math.min(width - px, w * width));
      const ph = Math.max(0, Math.min(height - py, h * height));
      if (pw < 4 || ph < 4) {
        return null;
      }
      return { x: px, y: py, w: pw, h: ph };
    })
    .filter(Boolean);
}

function renderEvidenceCanvas(sourceCanvas, width, height, boxes, { tintMoveOut }) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(sourceCanvas, 0, 0);

  if (tintMoveOut) {
    for (const box of boxes) {
      ctx.save();
      ctx.fillStyle = "rgba(239, 68, 68, 0.22)";
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.restore();
    }
  }

  for (const box of boxes) {
    drawHighlightBox(ctx, box);
  }

  return canvas.toDataURL("image/jpeg", 0.92);
}
