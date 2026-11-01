// File handling: turn uploaded resumes into text plus the layout facts the ATS
// checker needs, and export structured resumes / cover letters as DOCX.
import mammoth from "mammoth";
import JSZip from "jszip";
import { stripHtml } from "./text.js";
import { extractTextItems, getDocumentProxy } from "unpdf";
import {
  AlignmentType, Document, ExternalHyperlink, LevelFormat, Packer, Paragraph, TabStopType, TextRun, BorderStyle,
} from "docx";

const MAX_BYTES = 15 * 1024 * 1024;

function typeOf(name = "", mime = "") {
  const ext = String(name).toLowerCase().split(".").pop();
  if (ext === "docx" || /wordprocessingml/.test(mime)) return "docx";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (["txt", "md", "text"].includes(ext) || mime.startsWith("text/")) return "txt";
  if (ext === "doc") return "doc";
  return ext || "unknown";
}

/**
 * Parse an uploaded file.
 * @param {{name: string, mime?: string, data: string}} f data is base64 (a data: URL prefix is fine)
 * @returns {Promise<{text: string, meta: {type, hasTables, hasImages, multiColumn, pages, textLength, warnings: string[]}}>}
 */
export async function parseUpload({ name = "", mime = "", data = "" }) {
  const b64 = String(data).replace(/^data:[^,]*,/, "");
  const buf = Buffer.from(b64, "base64");
  if (!buf.length) throw httpError(400, "The file is empty.");
  if (buf.length > MAX_BYTES) throw httpError(413, "That file is over 15 MB. Export a smaller version.");
  const type = typeOf(name, mime);
  let out;
  if (type === "docx") out = await parseDocx(buf);
  else if (type === "pdf") out = await parsePdf(buf);
  else if (type === "txt") out = { text: buf.toString("utf8"), hasTables: false, hasImages: false, multiColumn: false, pages: null, warnings: [] };
  else if (type === "doc") throw httpError(415, "Old .doc files can't be read. Open it in Word or Google Docs and save as .docx or PDF.");
  else throw httpError(415, `Unsupported file type ".${type}". Use PDF, DOCX or TXT.`);
  const text = tidy(out.text);
  return {
    text,
    meta: {
      type,
      name,
      hasTables: !!out.hasTables,
      hasImages: !!out.hasImages,
      multiColumn: !!out.multiColumn,
      pages: out.pages ?? null,
      textLength: text.length,
      warnings: out.warnings || [],
    },
  };
}

function tidy(t = "") {
  return String(t).replace(/\r\n?/g, "\n").replace(/[ \t ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

async function parseDocx(buf) {
  const warnings = [];
  const [raw, html] = await Promise.all([
    mammoth.extractRawText({ buffer: buf }),
    mammoth.convertToHtml({ buffer: buf }, { convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: "" })) }),
  ]);
  let hasTables = /<table[\s>]/i.test(html.value);
  let hasImages = /<img[\s>]/i.test(html.value);
  let multiColumn = false;
  let pages = null;
  try {
    const zip = await JSZip.loadAsync(buf);
    const doc = (await zip.file("word/document.xml")?.async("string")) || "";
    hasTables ||= /<w:tbl>/.test(doc);
    hasImages ||= /<w:drawing>|<w:pict>|<v:imagedata/.test(doc) || Object.keys(zip.files).some((f) => /^word\/media\//.test(f));
    // Section columns (w:cols w:num="2") or text boxes both scramble reading order.
    multiColumn = /<w:cols\b[^>]*w:num="([2-9])"/.test(doc);
    if (/<w:txbxContent>/.test(doc)) warnings.push("Text boxes found. Many ATS skip text inside text boxes, so that content may be invisible.");
    const app = (await zip.file("docProps/app.xml")?.async("string")) || "";
    const m = app.match(/<Pages>(\d+)<\/Pages>/);
    if (m) pages = Number(m[1]);
    if (/<w:headerReference/.test(doc)) {
      const headers = Object.keys(zip.files).filter((f) => /^word\/header\d*\.xml$/.test(f));
      for (const h of headers) {
        const x = await zip.file(h).async("string");
        if (/@|linkedin|\d{3}[\s.-]\d{3}/i.test(x.replace(/<[^>]+>/g, ""))) {
          warnings.push("Contact details appear to be in the page header. Some ATS ignore headers; put them in the body.");
          break;
        }
      }
    }
  } catch {
    warnings.push("Couldn't inspect the DOCX layout in detail; text was still extracted.");
  }
  for (const m of raw.messages || []) if (m.type === "error") warnings.push(m.message);
  // The HTML keeps list bullets (raw text drops Word's numbering glyphs); fall back to raw text.
  const fromHtml = stripHtml(html.value.replace(/<\/t[dh]>/gi, "   ").replace(/<\/tr>/gi, "\n").replace(/<img[^>]*>/gi, ""));
  const text = fromHtml.replace(/\s/g, "").length >= raw.value.replace(/\s/g, "").length * 0.9 ? fromHtml : raw.value;
  return { text, hasTables, hasImages, multiColumn, pages, warnings };
}

async function parsePdf(buf) {
  const warnings = [];
  const data = new Uint8Array(buf);
  const pdf = await getDocumentProxy(data);
  const { totalPages, items } = await extractTextItems(pdf);
  const pageTexts = [];
  let colPages = 0;
  for (let p = 0; p < items.length; p++) {
    const page = await pdf.getPage(p + 1);
    const pageW = page.view[2] - page.view[0];
    const lines = groupLines(items[p]);
    const boundary = columnBoundary(lines, pageW);
    if (boundary) {
      colPages++;
      // Read the left column top to bottom, then the right one, like a person would.
      const left = [], right = [];
      for (const runs of lines) {
        const l = runs.filter((r) => r.x < boundary), rr = runs.filter((r) => r.x >= boundary);
        if (l.length) left.push(l);
        if (rr.length) right.push(rr);
      }
      pageTexts.push([...left, ...right].map(joinRuns).join("\n"));
    } else {
      pageTexts.push(lines.map(joinRuns).join("\n"));
    }
  }
  const multiColumn = colPages > 0;

  let hasImages = false;
  try {
    const { OPS } = await import("unpdf/pdfjs").then((m) => m).catch(() => ({}));
    const imageOps = OPS ? [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject] : [85, 86, 83];
    for (let p = 1; p <= Math.min(totalPages, 3) && !hasImages; p++) {
      const page = await pdf.getPage(p);
      const ops = await page.getOperatorList();
      hasImages = ops.fnArray.some((f) => imageOps.includes(f));
    }
  } catch {
    // Image detection is best-effort.
  }
  const text = pageTexts.join("\n\n");
  if (text.replace(/\s/g, "").length < 200) warnings.push("Almost no selectable text. This PDF may be scanned or have text converted to outlines.");
  // A table in a PDF can't be detected reliably; it shows up as columns instead.
  return { text, hasTables: false, hasImages, multiColumn, pages: totalPages, warnings };
}

function groupLines(items = []) {
  const rows = [];
  for (const it of items) {
    if (!it.str && !it.hasEOL) continue;
    let row = rows.find((r) => Math.abs(r.y - it.y) < Math.max(2, it.fontSize * 0.35));
    if (!row) rows.push((row = { y: it.y, runs: [] }));
    if (it.str) row.runs.push(it);
  }
  return rows
    .filter((r) => r.runs.length)
    .sort((a, b) => b.y - a.y)
    .map((r) => r.runs.sort((a, b) => a.x - b.x));
}

// Detects a second text column: many lines that start well inside the page while
// many others start at the left margin, with no line text crossing the gap.
function columnBoundary(lines, pageW) {
  if (lines.length < 12) return null;
  const starts = lines.map((runs) => runs[0].x);
  const margin = Math.min(...starts);
  const inner = lines.filter((runs) => runs[0].x > margin + pageW * 0.22 && runs.map((r) => r.str).join("").trim().length > 8);
  if (inner.length < lines.length * 0.2) return null;
  const boundary = Math.min(...inner.map((runs) => runs[0].x)) - 2;
  const leftLines = lines.filter((runs) => runs[0].x < boundary);
  if (leftLines.length < lines.length * 0.2) return null;
  // Right-aligned dates on a single-column resume also start mid-page; require a real gap.
  const crossing = lines.filter((runs) => runs.some((r) => r.x < boundary && r.x + r.width > boundary + 4)).length;
  if (crossing > lines.length * 0.1) return null;
  const leftMostlyShort = leftLines.filter((runs) => runs.some((r) => r.x >= boundary)).length > leftLines.length * 0.6;
  return leftMostlyShort ? null : boundary;
}

function joinRuns(runs) {
  let s = "";
  let end = null;
  for (const r of runs) {
    if (end != null) {
      const gap = r.x - end;
      if (gap > r.fontSize * 1.5) s += "   ";
      else if (gap > r.fontSize * 0.15 && !s.endsWith(" ") && !r.str.startsWith(" ")) s += " ";
    }
    s += r.str;
    end = r.x + r.width;
  }
  return s.replace(/\s+$/, "");
}

// ---------- DOCX export ----------

const TEMPLATES = {
  original: { font: "Calibri", size: 21, headingSize: 22, nameSize: 36, accent: "000000", rule: true },
  classic: { font: "Georgia", size: 21, headingSize: 22, nameSize: 34, accent: "000000", rule: true },
  modern: { font: "Arial", size: 20, headingSize: 22, nameSize: 36, accent: "2F5D8A", rule: false },
  compact: { font: "Arial", size: 18, headingSize: 19, nameSize: 28, accent: "000000", rule: true },
};

function applyCase(s, mode) {
  if (mode === "UPPERCASE") return s.toUpperCase();
  if (mode === "Title Case") return s.replace(/\w\S*/g, (w) => (/^(and|of|the|&|in|for)$/i.test(w) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1)));
  if (mode === "Sentence case") return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return s;
}

function linkRun(url, t) {
  const href = /^https?:\/\//i.test(url) ? url : /@/.test(url) ? `mailto:${url}` : `https://${url}`;
  return new ExternalHyperlink({ link: href, children: [new TextRun({ text: url, style: "Hyperlink", font: t.font, size: t.size })] });
}

/**
 * @param {object} resume ResumeSchema-shaped object
 * @param {string} [template] original | classic | modern | compact
 * @returns {Promise<Buffer>}
 */
export async function resumeToDocx(resume, template = "original") {
  const t = TEMPLATES[template] || TEMPLATES.original;
  const fmt = resume.format || {};
  const headingCase = template === "original" ? fmt.headingCase || "UPPERCASE" : template === "modern" ? "Title Case" : "UPPERCASE";
  const bulletChar = template === "original" && fmt.bulletChar ? fmt.bulletChar.trim().slice(0, 1) || "•" : "•";
  const c = resume.contact || {};
  const space = template === "compact" ? 40 : 80;
  const kids = [];

  kids.push(new Paragraph({ alignment: template === "modern" ? AlignmentType.LEFT : AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: c.name || "", bold: true, size: t.nameSize, font: t.font, color: t.accent })] }));
  if (c.headline) kids.push(new Paragraph({ alignment: template === "modern" ? AlignmentType.LEFT : AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: c.headline, size: t.size + 2, font: t.font })] }));
  const contactBits = [c.location, c.phone].filter(Boolean).map((x) => new TextRun({ text: x, size: t.size, font: t.font }));
  const linkBits = [c.email, ...(c.links || [])].filter(Boolean).map((x) => linkRun(x, t));
  const all = [...contactBits, ...linkBits];
  const line = [];
  all.forEach((r, i) => {
    if (i) line.push(new TextRun({ text: "  |  ", size: t.size, font: t.font }));
    line.push(r);
  });
  if (line.length) kids.push(new Paragraph({ alignment: template === "modern" ? AlignmentType.LEFT : AlignmentType.CENTER, spacing: { after: 160 }, children: line }));

  for (const sec of resume.sections || []) {
    kids.push(new Paragraph({
      spacing: { before: 200, after: 80 },
      border: t.rule ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 2 } } : undefined,
      children: [new TextRun({ text: applyCase(sec.heading || "", headingCase), bold: true, size: t.headingSize, font: t.font, color: t.accent })],
    }));
    if (sec.text) for (const para of String(sec.text).split(/\n+/)) kids.push(new Paragraph({ spacing: { after: space }, children: [new TextRun({ text: para, size: t.size, font: t.font })] }));
    for (const it of sec.items || []) {
      const left = [it.title, it.organization].filter(Boolean).join(sec.kind === "education" ? ", " : " | ");
      const right = [it.location, it.dates].filter(Boolean).join("  ·  ");
      if (left || right) {
        kids.push(new Paragraph({
          spacing: { before: 60, after: 20 },
          tabStops: [{ type: TabStopType.RIGHT, position: 10080 }],
          keepNext: true,
          children: [new TextRun({ text: left, bold: true, size: t.size, font: t.font }), ...(right ? [new TextRun({ text: `\t${right}`, size: t.size, font: t.font })] : [])],
        }));
      }
      if (it.details) kids.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: it.details, size: t.size, font: t.font })] }));
      for (const b of it.bullets || []) {
        kids.push(new Paragraph({ numbering: { reference: "resume-bullets", level: 0 }, spacing: { after: 20 }, children: [new TextRun({ text: b, size: t.size, font: t.font })] }));
      }
    }
  }

  const doc = new Document({
    creator: c.name || "Career Copilot",
    title: `${c.name || "Resume"} resume`,
    styles: { default: { document: { run: { font: t.font, size: t.size } } } },
    numbering: {
      config: [{
        reference: "resume-bullets",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: bulletChar, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }],
      }],
    },
    sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 1080, right: 1080 } } }, children: kids }],
  });
  return Packer.toBuffer(doc);
}

/**
 * @param {{name?, contactLines?: string[], date?, recipient?, subject?, greeting?, body: string, signoff?}} letter
 */
export async function coverLetterToDocx(letter) {
  const font = "Calibri", size = 22;
  const p = (text, opts = {}) => new Paragraph({ spacing: { after: 200 }, ...opts, children: [new TextRun({ text, font, size, ...(opts.run || {}) })] });
  const kids = [];
  if (letter.name) kids.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: letter.name, bold: true, font, size: 28 })] }));
  for (const l of letter.contactLines || []) if (l) kids.push(new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: l, font, size: 20 })] }));
  kids.push(p(""));
  kids.push(p(letter.date || new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })));
  if (letter.recipient) for (const l of String(letter.recipient).split(/\n/)) kids.push(new Paragraph({ children: [new TextRun({ text: l, font, size })] }));
  if (letter.recipient) kids.push(p(""));
  if (letter.subject) kids.push(p(`Re: ${letter.subject}`, { run: { bold: true } }));
  if (letter.greeting) kids.push(p(letter.greeting));
  for (const para of String(letter.body || "").split(/\n\s*\n/)) if (para.trim()) kids.push(p(para.trim().replace(/\n/g, " ")));
  if (letter.signoff) for (const l of String(letter.signoff).split(/\n/)) kids.push(new Paragraph({ children: [new TextRun({ text: l, font, size })] }));
  const doc = new Document({
    creator: letter.name || "Career Copilot",
    title: "Cover letter",
    sections: [{ properties: { page: { margin: { top: 1080, bottom: 1080, left: 1260, right: 1260 } } }, children: kids }],
  });
  return Packer.toBuffer(doc);
}

// Plain-text ATS version of a structured resume.
export function resumeToText(resume) {
  const c = resume.contact || {};
  const out = [c.name, c.headline, [c.location, c.phone, c.email, ...(c.links || [])].filter(Boolean).join(" | "), ""];
  for (const s of resume.sections || []) {
    out.push((s.heading || "").toUpperCase());
    if (s.text) out.push(s.text);
    for (const it of s.items || []) {
      const head = [it.title, it.organization, it.location, it.dates].filter(Boolean).join(" | ");
      if (head) out.push(head);
      if (it.details) out.push(it.details);
      for (const b of it.bullets || []) out.push(`- ${b}`);
    }
    out.push("");
  }
  return out.filter((x) => x != null).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
