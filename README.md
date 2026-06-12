# Move-In / Move-Out Inspection Photo Compare

Local web app for comparing tenant inspection photos by area, detecting post-move-in damage, and filtering normal wear and tear based on tenancy length and standard item useful-life estimates.

## Features

- Drag-and-drop upload zones for **move-in** and **move-out inspection report PDFs**
- **Embedded photo extraction** from each PDF (room photos inside the report, not separate uploads)
- **Automatic inspection date parsing** from uploaded PDF text
- Tag each photo by room/area (kitchen, bathroom, bedrooms, etc.)
- Side-by-side comparison with a **change heatmap** for each matched area
- **Wear-and-tear engine** uses move-in vs move-out dates and item lifespans (paint, carpet, flooring, fixtures, appliances) to classify findings as chargeable damage or normal wear
- Optional **AI vision analysis** (Claude or OpenAI) for detailed damage descriptions when running the local server

## Quick start

```bash
cd inspection-photo-compare
npm install
npm start
```

Open [http://localhost:8080](http://localhost:8080)

For pixel comparison only (no AI), you can also serve static files:

```bash
python3 -m http.server 8080
```

AI vision requires `npm start` so your API key stays on your machine via the local proxy.

## How to use

1. Drag the **move-in inspection PDF** into the left panel and the **move-out inspection PDF** into the right panel.
2. The tool extracts **embedded photos** and the **inspection date** from each report.
3. Review auto-filled dates and adjust **area tags** on extracted photos if needed.
4. Optionally choose **Claude** or **OpenAI** and enter your API key for AI-generated item findings.
5. Click **Analyze comparisons** to review results per area.

If a PDF has no extractable embedded images, the tool falls back to rendering each page (common with flat scanned reports).

## Date parsing

The PDF parser looks for labeled dates such as “Move-in inspection date”, “Move-out date”, “Inspection date”, and common `MM/DD/YYYY` formats. It falls back to PDF metadata when no labeled date is found. Always verify parsed dates before relying on wear-and-tear calculations.

## Wear and tear logic

For each finding, the tool compares:

- **Observed severity** (0–100) from pixel diff and/or AI vision
- **Expected wear** = tenancy years ÷ item useful life × 100

If observed severity is within expected wear (plus a small buffer), the finding is classified as **wear and tear**. Otherwise it is flagged as **possible tenant damage** for manual review.

Default useful-life values (years) are in `lib/wearAndTear.js` — adjust them to match your market, lease, or attorney guidance.

## Files

| File | Purpose |
|------|---------|
| `index.html` | UI layout |
| `styles.css` | Styling |
| `app.js` | Upload, pairing, analysis orchestration |
| `lib/wearAndTear.js` | Tenancy math and item lifespans |
| `lib/pdfParser.js` | PDF text extraction, date parsing, page rendering |
| `lib/imageCompare.js` | Canvas pixel diff and heatmap |
| `lib/visionAnalysis.js` | Client calls to local vision proxy |
| `server.js` | Static file server + Claude/OpenAI vision proxy |

## Important note

This app is a **screening aid**, not legal advice or a certified inspection report. California and local rules on deposit deductions and wear vs damage vary. Have qualified counsel review outcomes before withholding deposit or issuing charge notices.
