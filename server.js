import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: "25mb" }));
app.use(express.static(__dirname));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/analyze-comparison", async (req, res) => {
  try {
    const { moveInImage, moveOutImage, area, tenancyYears, apiKey } = req.body || {};

    if (!apiKey) {
      return res.status(400).json({ error: "OpenAI API key is required." });
    }
    if (!moveInImage || !moveOutImage) {
      return res.status(400).json({ error: "Both move-in and move-out images are required." });
    }

    const prompt = buildVisionPrompt(area, tenancyYears);
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "text", text: "MOVE-IN INSPECTION PHOTO:" },
              { type: "image_url", image_url: { url: moveInImage, detail: "high" } },
              { type: "text", text: "MOVE-OUT INSPECTION PHOTO (same area):" },
              { type: "image_url", image_url: { url: moveOutImage, detail: "high" } },
            ],
          },
        ],
        max_tokens: 1200,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      return res.status(response.status).json({
        error: `OpenAI API error: ${errBody.slice(0, 300)}`,
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return res.status(502).json({ error: "Empty response from vision model." });
    }

    const parsed = JSON.parse(content);
    res.json(normalizeVisionResponse(parsed));
  } catch (err) {
    console.error("analyze-comparison error:", err);
    res.status(500).json({ error: err.message || "Analysis failed." });
  }
});

function buildVisionPrompt(area, tenancyYears) {
  return `You are assisting a property manager compare move-in and move-out inspection photos for the area: "${area}".

Tenancy length: ${Number(tenancyYears).toFixed(2)} years.

Compare the move-in photo to the move-out photo. Identify ONLY damage or deterioration that appears NEW at move-out (not present at move-in). Ignore differences caused by lighting, camera angle, furniture, or staging.

For each new issue found, estimate:
- title: short label
- description: what changed and where in the frame
- itemKey: one of interior_paint, carpet, vinyl_flooring, laminate_flooring, hardwood_flooring, tile_flooring, countertop_laminate, countertop_solid, cabinet_finish, interior_door, window_blinds, window_screens, refrigerator, range_oven, dishwasher, washer_dryer, bathroom_fixture, toilet, tub_shower, drywall, baseboard_trim, light_fixture, general_wall, general_floor, general
- severity: number 0-100 indicating how significant the damage is relative to replacing/refinishing that item

Do NOT list pre-existing move-in conditions. If nothing new is visible, return an empty findings array.

Respond with JSON only:
{
  "findings": [
    {
      "title": "...",
      "description": "...",
      "itemKey": "...",
      "severity": 0
    }
  ],
  "summary": "one sentence overall assessment"
}`;
}

function normalizeVisionResponse(parsed) {
  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  return {
    findings: findings.map((finding) => ({
      title: finding.title || "Damage noted",
      description: finding.description || "",
      itemKey: finding.itemKey || "general",
      severity: clampNumber(finding.severity, 0, 100, 40),
      rationale: finding.rationale || parsed.summary || "",
    })),
    summary: parsed.summary || "",
  };
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (Number.isNaN(num)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, num));
}

app.listen(PORT, () => {
  console.log(`Inspection compare tool running at http://localhost:${PORT}`);
  console.log("OpenAI vision proxy available at POST /api/analyze-comparison");
});
