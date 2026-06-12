/**
 * Request structured damage analysis from local server proxy (Claude or OpenAI vision).
 * @param {object} params
 * @param {string} params.moveInBase64
 * @param {string} params.moveOutBase64
 * @param {string} params.area
 * @param {number} params.tenancyYears
 * @param {string} params.apiKey
 * @param {"claude"|"openai"} [params.provider]
 */
export async function analyzeWithVision({
  moveInBase64,
  moveOutBase64,
  area,
  tenancyYears,
  apiKey,
  provider = "claude",
}) {
  const response = await fetch("/api/analyze-comparison", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      moveInImage: moveInBase64,
      moveOutImage: moveOutBase64,
      area,
      tenancyYears,
      apiKey,
      provider,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Vision analysis failed (${response.status})`);
  }

  return response.json();
}

export async function checkServerAvailable() {
  try {
    const response = await fetch("/api/health", { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}
