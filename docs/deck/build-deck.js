const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const { FaQuestion, FaFileAlt, FaCheckDouble, FaLink, FaSyncAlt, FaBuilding } = require("react-icons/fa");

const OUT = process.argv[2];
const STATUS = process.argv[3] || "Working demo · offline test suite status: pending";

const C = {
  ink: "16302B",     // deep evergreen — dominant
  tint: "EDF3EF",    // pale mint for cards
  mid: "5B6E68",     // muted body text
  gold: "C9A227",    // accent: citations
  white: "FFFFFF",
  line: "D5E0DA",
};
const HEAD = "Cambria", BODY = "Calibri";

async function icon(Comp, color, px = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(Comp, { color: "#" + color, size: px }));
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

(async () => {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_16x9"; // 10 x 5.625
  const s = pres.addSlide();
  s.background = { color: C.white };

  // ---- Title + pitch --------------------------------------------------
  s.addText("Ask a company anything, grounded in its SEC filings", {
    x: 0.5, y: 0.35, w: 9.0, h: 0.6, fontFace: HEAD, fontSize: 25, bold: true, color: C.ink,
    isTextBox: true, margin: 0, valign: "middle",
  });
  s.addText(
    "Pick a stock, ask a plain-English question, and get today's price plus an answer built only from what the company has filed with the SEC. Every claim links back to its source.",
    { x: 0.5, y: 0.98, w: 9.0, h: 0.55, fontFace: BODY, fontSize: 13, color: C.mid, isTextBox: true, margin: 0, valign: "top" },
  );

  // ---- Left: three steps ---------------------------------------------
  const steps = [
    [FaQuestion, "You ask", "“What are Apple’s biggest risks this year?”"],
    [FaFileAlt, "We read the company’s own filings", "Annual and quarterly reports, straight from the SEC."],
    [FaCheckDouble, "You get a cited answer", "Headline, key points, risks, and today’s quote."],
  ];
  let y = 1.75;
  for (const [Comp, head, desc] of steps) {
    s.addShape(pres.shapes.OVAL, { x: 0.5, y, w: 0.5, h: 0.5, fill: { color: C.ink }, line: { color: C.ink } });
    s.addImage({ data: await icon(Comp, C.white), x: 0.62, y: y + 0.12, w: 0.26, h: 0.26 });
    s.addText(head, { x: 1.15, y: y - 0.02, w: 3.4, h: 0.28, fontFace: BODY, fontSize: 14, bold: true, color: C.ink, isTextBox: true, margin: 0, valign: "middle" });
    s.addText(desc, { x: 1.15, y: y + 0.26, w: 3.4, h: 0.3, fontFace: BODY, fontSize: 11, color: C.mid, isTextBox: true, margin: 0, valign: "top" });
    y += 0.72;
  }

  // ---- Right: answer-view mockup --------------------------------------
  const mx = 5.0, my = 1.7, mw = 4.5, mh = 2.2;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: mx, y: my, w: mw, h: mh, rectRadius: 0.08, fill: { color: C.white }, line: { color: C.line, width: 1 },
    shadow: { type: "outer", blur: 6, offset: 2, angle: 90, color: "000000", opacity: 0.12 },
  });
  // quote strip
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: mx, y: my, w: mw, h: 0.42, rectRadius: 0.08, fill: { color: C.tint }, line: { color: C.tint } });
  s.addText([
    { text: "AAPL  ", options: { bold: true, color: C.ink } },
    { text: "Apple Inc.   ", options: { color: C.mid } },
    { text: "$231.40  ", options: { bold: true, color: C.ink } },
    { text: "▲ 1.2%  ", options: { color: "2E7D32" } },
    { text: "live quote", options: { color: C.mid, italic: true } },
  ], { x: mx + 0.18, y: my, w: mw - 0.3, h: 0.42, fontFace: BODY, fontSize: 10.5, isTextBox: true, margin: 0, valign: "middle" });

  s.addText("Supply concentration and China exposure remain the largest disclosed risks.", {
    x: mx + 0.18, y: my + 0.5, w: mw - 0.36, h: 0.42, fontFace: HEAD, fontSize: 11.5, bold: true, color: C.ink, isTextBox: true, margin: 0, valign: "top",
  });
  s.addText([
    { text: "Key points", options: { bold: true, color: C.ink, breakLine: true } },
    { text: "Revenue concentration: iPhone is more than half of sales", options: { bullet: { indent: 10 }, breakLine: true } },
    { text: "Supply chain: most final assembly in a single region", options: { bullet: { indent: 10 }, breakLine: true } },
    { text: "Risks", options: { bold: true, color: C.ink, breakLine: true } },
    { text: "Regulatory action on App Store fees in the EU and US", options: { bullet: { indent: 10 } } },
  ], { x: mx + 0.18, y: my + 0.95, w: mw - 0.36, h: 0.85, fontFace: BODY, fontSize: 9.5, color: C.mid, isTextBox: true, margin: 0, valign: "top", paraSpaceAfter: 1 });

  // citation chip
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: mx + 0.18, y: my + mh - 0.36, w: 2.5, h: 0.24, rectRadius: 0.12, fill: { color: C.gold }, line: { color: C.gold } });
  s.addImage({ data: await icon(FaLink, C.ink), x: mx + 0.27, y: my + mh - 0.31, w: 0.14, h: 0.14 });
  s.addText("10-K · filed 2025-11-01 · Item 1A Risk Factors", { x: mx + 0.46, y: my + mh - 0.36, w: 2.2, h: 0.24, fontFace: BODY, fontSize: 8.5, bold: true, color: C.ink, isTextBox: true, margin: 0, valign: "middle" });
  s.addText("Illustrative", { x: mx + mw - 1.0, y: my + mh - 0.34, w: 0.85, h: 0.2, fontFace: BODY, fontSize: 8, italic: true, color: C.mid, isTextBox: true, margin: 0, align: "right", valign: "middle" });

  // ---- Bottom: three trust tiles --------------------------------------
  const tiles = [
    [FaLink, "Sources you can check", "Every answer cites the filing, the section, and the exact excerpt it came from."],
    [FaSyncAlt, "Fresh when it matters", "New filings are picked up automatically. Otherwise past research is reused and only the price refreshes."],
    [FaBuilding, "Broad coverage", "Any of roughly 10,000 US-listed companies in the SEC’s public directory."],
  ];
  const tw = 2.8, ty = 4.05, th = 1.02;
  for (let i = 0; i < tiles.length; i++) {
    const [Comp, head, desc] = tiles[i];
    const tx = 0.5 + i * (tw + 0.3);
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: tx, y: ty, w: tw, h: th, rectRadius: 0.08, fill: { color: C.tint }, line: { color: C.tint } });
    s.addShape(pres.shapes.OVAL, { x: tx + 0.15, y: ty + 0.15, w: 0.36, h: 0.36, fill: { color: C.ink }, line: { color: C.ink } });
    s.addImage({ data: await icon(Comp, C.white), x: tx + 0.24, y: ty + 0.24, w: 0.18, h: 0.18 });
    s.addText(head, { x: tx + 0.62, y: ty + 0.13, w: tw - 0.75, h: 0.3, fontFace: BODY, fontSize: 12.5, bold: true, color: C.ink, isTextBox: true, margin: 0, valign: "middle" });
    s.addText(desc, { x: tx + 0.15, y: ty + 0.5, w: tw - 0.3, h: 0.5, fontFace: BODY, fontSize: 9, color: C.mid, isTextBox: true, margin: 0, valign: "top" });
  }

  // ---- Footer ---------------------------------------------------------
  s.addText(STATUS, { x: 0.5, y: 5.22, w: 6.5, h: 0.25, fontFace: BODY, fontSize: 9, color: C.mid, isTextBox: true, margin: 0, valign: "middle" });
  s.addText("Research tool, not investment advice", { x: 7.0, y: 5.22, w: 2.5, h: 0.25, fontFace: BODY, fontSize: 9, italic: true, color: C.mid, isTextBox: true, margin: 0, align: "right", valign: "middle" });

  s.addNotes(
    "One-minute version: this is a research assistant that only answers from a company's own SEC filings, so every statement can be traced to a document. " +
    "Walk the three steps on the left, then point at the citation chip on the mockup: that chip is the whole point. " +
    "The bottom tiles are the trust story: sources, freshness, coverage. Close on the footer: it is a research tool, not advice.",
  );

  await pres.writeFile({ fileName: OUT });
  console.log("wrote", OUT);
})().catch((e) => { console.error(e); process.exit(1); });
