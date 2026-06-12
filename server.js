import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(path.join(__dirname, ".env"));

const app = express();
const PORT = process.env.PORT || 8080;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const DEFAULT_PROVIDER = process.env.VISION_PROVIDER === "openai" ? "openai" : "claude";

app.use(express.json({ limit: "25mb" }));
app.use(express.static(__dirname));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    providers: ["claude", "openai"],
    defaultProvider: DEFAULT_PROVIDER,
    keysConfigured: {
      claude: Boolean(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
    },
  });
});

app.post("/api/analyze-comparison", async (req, res) => {
  try {
    const {
      moveInImage,
      moveOutImage,
      area,
      tenancyYears,
      apiKey: clientApiKey,
      provider = DEFAULT_PROVIDER,
    } = req.body || {};

    const apiKey = resolveApiKey(provider, clientApiKey);
    if (!apiKey) {
      return res.status(400).json({
        error:
          "API key is required. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env, or enter a key in the browser.",
      });
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

function resolveApiKey(provider, clientApiKey) {
  const envKey =
    provider === "openai"
      ? process.env.OPENAI_API_KEY
      : process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  return String(envKey || clientApiKey || "").trim();
}

function loadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return;
    }
    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const eq = trimmed.indexOf("=");
      if (eq === -1) {
        continue;
      }
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch (err) {
    console.warn("Could not load .env file:", err.message);
  }
}

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
      max_tokens: 1600,
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
      max_tokens: 1600,
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

These are PRIMARY 3D room photos of the same space. They should be nearly the same viewpoint, but small angle or lighting differences are normal. Compare them semantically — do NOT treat pixel-level or alignment differences as damage.

Identify ONLY damage that is NEW at move-out (not present at move-in). Ignore lighting, camera angle, color balance, and staging differences.

For each new issue found, name the specific item damaged (e.g. "Carpet", "Interior paint", "Kitchen countertop", "Bathroom tub", "Refrigerator") and describe exactly what changed.

For every issue where chargeTenant is true, include highlightBox: a normalized bounding box (0.0–1.0) on the MOVE-OUT photo locating the damage.

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
      "chargeTenant": true or false,
      "highlightBox": { "x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0 }
    }
  ]
}

List every distinct damaged item separately. Use chargeTenant=false for normal wear only. Use chargeTenant=true only when that specific item should be charged. Omit highlightBox when chargeTenant is false.`;
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
      highlightBox: normalizeHighlightBox(issue.highlightBox),
    })),
  };
}

function normalizeHighlightBox(box) {
  if (!box || typeof box !== "object") {
    return null;
  }
  const x = Number(box.x);
  const y = Number(box.y);
  const width = Number(box.width ?? box.w);
  const height = Number(box.height ?? box.h);
  if ([x, y, width, height].some((value) => Number.isNaN(value))) {
    return null;
  }
  if (width <= 0 || height <= 0) {
    return null;
  }
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
    width: Math.max(0, Math.min(1, width)),
    height: Math.max(0, Math.min(1, height)),
  };
}

app.listen(PORT, () => {
  console.log(`Inspection compare tool running at http://localhost:${PORT}`);
  console.log("Vision proxy available at POST /api/analyze-comparison (claude | openai)");
  if (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY) {
    console.log("Claude API key loaded from environment.");
  }
  if (process.env.OPENAI_API_KEY) {
    console.log("OpenAI API key loaded from environment.");
  }
});
