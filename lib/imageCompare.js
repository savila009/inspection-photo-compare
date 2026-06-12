/**
 * Resize and compare two images on canvas; return diff metrics and heatmap data URL.
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

  const heatCanvas = document.createElement("canvas");
  heatCanvas.width = width;
  heatCanvas.height = height;
  const heatCtx = heatCanvas.getContext("2d");
  const heatData = heatCtx.createImageData(width, height);

  let totalDiff = 0;
  let significantPixels = 0;
  const pixelCount = width * height;
  const threshold = 28;

  for (let i = 0; i < dataA.length; i += 4) {
    const dr = Math.abs(dataA[i] - dataB[i]);
    const dg = Math.abs(dataA[i + 1] - dataB[i + 1]);
    const db = Math.abs(dataA[i + 2] - dataB[i + 2]);
    const diff = (dr + dg + db) / 3;
    totalDiff += diff;

    if (diff > threshold) {
      significantPixels += 1;
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

  const avgDiff = totalDiff / (pixelCount * 255 / 3);
  const changedAreaPercent = (significantPixels / pixelCount) * 100;
  const severityScore = Math.min(100, changedAreaPercent * 2.5 + avgDiff * 35);

  return {
    severityScore,
    changedAreaPercent,
    avgDiff,
    heatmapDataUrl: heatCanvas.toDataURL("image/png"),
    width,
    height,
  };
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
