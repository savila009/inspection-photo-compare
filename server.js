import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

app.use(express.json({ limit: "25mb" }));
app.use(express.static(__dirname));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, providers: ["claude", "openai"] });
});

app.post("/api/analyze-comparison", async (req, res) => {
  try {
    const {
      moveInImage,
      moveOutImage,
      area,
      tenancyYears,
      apiKey,
      provider = "claude",
    } = req.body || {};

    if (!apiKey) {
      return res.status(400).json({ error: "API key is required." });
    }
    if (!moveInImage || !moveOutImage) {
      return res.status(400).json({ error: "Both move-in and move-out images are required." });
    }

    const prompt = buildVisionPrompt(area, tenancyYears);
    const parsed =
      provider === "openai"
        ? await callOpenAI(apiKey, prompt, moveInImage, moveOutImage)
        : await callClaude(apiKey, prompt, moveInImage, moveOutImage);

    res.json(normalizeVisionResponse(parsed));
  } catch (err) {
    console.error("analyze-comparison error:", err);
    res.status(500).json({ error: err.message || "Analysis failed." });
  }
});

async function callOpenAI(apiKey, prompt, moveInImage, moveOutImage) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
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
    throw new Error(`OpenAI API error: ${errBody.slice(0, 300)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from OpenAI vision model.");
  }

  return parseJsonFromModelText(content);
}

async function callClaude(apiKey, prompt, moveInImage, moveOutImage) {
  const moveIn = parseDataUrl(moveInImage);
  const moveOut = parseDataUrl(moveOutImage);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1200,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "text", text: "MOVE-IN INSPECTION PHOTO:" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: moveIn.mediaType,
                data: moveIn.data,
              },
            },
            { type: "text", text: "MOVE-OUT INSPECTION PHOTO (same area):" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: moveOut.mediaType,
                data: moveOut.data,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Claude API error: ${errBody.slice(0, 300)}`);
  }

  const data = await response.json();
  const textBlock = data.content?.find((block) => block.type === "text");
  if (!textBlock?.text) {
    throw new Error("Empty response from Claude vision model.");
  }

  return parseJsonFromModelText(textBlock.text);
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid image data URL.");
  }
  return { mediaType: match[1], data: match[2] };
}

function parseJsonFromModelText(text) {
  const trimmed = String(text).trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(jsonStr);
}

function buildVisionPrompt(area, tenancyYears) {
  return `You are assisting a property manager compare move-in and move-out inspection photos for the area: "${area}".

Tenancy length: ${Number(tenancyYears).toFixed(2)} years.

These are PRIMARY 3D or main room photos. Compare move-in to move-out. Identify ONLY damage that is NEW at move-out (not present at move-in). Ignore lighting, angle, and staging differences.

For each new issue found, name the specific item damaged (e.g. "Carpet", "Interior paint", "Kitchen countertop", "Bathroom tub", "Refrigerator") and describe exactly what changed.

Respond with JSON only:
{
  "chargeTenant": true or false,
  "summary": "One plain-English sentence",
  "issues": [
    {
      "itemName": "Specific item name in plain English",
      "title": "short label",
      "description": "Specific damage — what, where, size if visible",
      "damage": "same as description",
      "itemKey": "interior_paint|carpet|countertop_laminate|tub_shower|refrigerator|cabinet_finish|tile_flooring|etc",
      "chargeTenant": true or false
    }
  ]
}

List every distinct damaged item separately. Use chargeTenant=false for normal wear only. Use chargeTenant=true only when that specific item should be charged.`;
}

function normalizeVisionResponse(parsed) {
  const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
  const chargeTenant =
    parsed.chargeTenant === true || issues.some((issue) => issue.chargeTenant === true);

  return {
    chargeTenant,
    summary: parsed.summary || (chargeTenant ? "New damage beyond normal wear." : "No chargeable damage."),
    reason: parsed.summary || "",
    issues: issues.map((issue) => ({
      title: issue.title || "Issue noted",
      itemName: issue.itemName || issue.title || "",
      description: issue.description || issue.damage || "",
      damage: issue.damage || issue.description || "",
      itemKey: issue.itemKey || "general",
      chargeTenant: issue.chargeTenant === true,
    })),
  };
}

app.listen(PORT, () => {
  console.log(`Inspection compare tool running at http://localhost:${PORT}`);
  console.log("Vision proxy available at POST /api/analyze-comparison (claude | openai)");
});
