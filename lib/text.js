// Shared text helpers: HTML stripping, skill vocabulary, keyword matching.

export function stripHtml(html = "") {
  return String(html)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/<\s*(br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&#39;|&rsquo;|&#8217;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

export function norm(s = "") {
  return String(s).toLowerCase().replace(/[^a-z0-9+#./ ]+/g, " ").replace(/\s+/g, " ").trim();
}

// Canonical skill -> aliases. Motion graphics first, then general creative, tech and business.
// Matching uses the canonical name or any alias, so "AE" counts as After Effects.
export const SKILLS = {
  "After Effects": ["after effects", "adobe after effects", "ae"],
  "Cinema 4D": ["cinema 4d", "c4d", "cinema4d"],
  "Premiere Pro": ["premiere pro", "adobe premiere", "premiere"],
  "Photoshop": ["photoshop", "adobe photoshop"],
  "Illustrator": ["illustrator", "adobe illustrator"],
  "InDesign": ["indesign"],
  "Adobe Creative Suite": ["adobe creative suite", "creative cloud", "adobe cc", "adobe suite"],
  "Blender": ["blender"],
  "Houdini": ["houdini", "sidefx"],
  "Maya": ["maya", "autodesk maya"],
  "3ds Max": ["3ds max", "3dsmax"],
  "Nuke": ["nuke"],
  "DaVinci Resolve": ["davinci resolve", "davinci", "resolve"],
  "Final Cut Pro": ["final cut", "final cut pro"],
  "Unreal Engine": ["unreal engine", "unreal", "ue5"],
  "Unity": ["unity", "unity3d"],
  "Redshift": ["redshift"],
  "Octane": ["octane", "octane render"],
  "Arnold": ["arnold"],
  "Substance": ["substance painter", "substance designer", "substance"],
  "ZBrush": ["zbrush"],
  "Figma": ["figma"],
  "Sketch": ["sketch app"],
  "Rive": ["rive"],
  "Lottie": ["lottie", "bodymovin"],
  "Spline": ["spline 3d", "spline"],
  "Jitter": ["jitter"],
  "Framer": ["framer"],
  "Protopie": ["protopie"],
  "Trapcode": ["trapcode", "particular"],
  "Element 3D": ["element 3d"],
  "Duik": ["duik"],
  "Motion design": ["motion design", "motion designer", "motion graphics", "mograph", "motion graphic"],
  "2D animation": ["2d animation", "2d animator", "2d motion", "cel animation", "frame by frame"],
  "3D animation": ["3d animation", "3d animator", "3d motion"],
  "Character animation": ["character animation", "character rigging", "rigging"],
  "Kinetic typography": ["kinetic typography", "kinetic type", "type animation"],
  "UI animation": ["ui animation", "ux motion", "product motion", "micro-interactions", "microinteractions", "interaction design"],
  "Compositing": ["compositing", "compositor"],
  "VFX": ["vfx", "visual effects"],
  "Rotoscoping": ["rotoscoping", "roto"],
  "Color grading": ["color grading", "colour grading", "color correction"],
  "Video editing": ["video editing", "video editor", "editing"],
  "Storyboarding": ["storyboarding", "storyboard", "storyboards", "animatic", "animatics"],
  "Illustration": ["illustration", "illustrator role"],
  "Graphic design": ["graphic design", "graphic designer"],
  "Brand design": ["brand design", "branding", "brand identity", "visual identity"],
  "Art direction": ["art direction", "art director"],
  "Typography": ["typography"],
  "Social media content": ["social media", "social content", "tiktok", "instagram reels", "short-form"],
  "Broadcast design": ["broadcast design", "broadcast graphics", "on-air", "lower thirds"],
  "Explainer videos": ["explainer", "explainer videos"],
  "Sound design": ["sound design", "audio editing"],
  "Expressions/scripting": ["expressions", "extendscript", "after effects scripting"],
  "HTML/CSS": ["html", "css", "html/css"],
  "JavaScript": ["javascript", "js", "typescript"],
  "React": ["react", "react.js"],
  "Python": ["python"],
  "SQL": ["sql"],
  "Excel": ["excel", "spreadsheets"],
  "Project management": ["project management", "project manager", "pmp"],
  "Agile": ["agile", "scrum", "kanban"],
  "Stakeholder management": ["stakeholder", "stakeholders", "client management", "client-facing"],
  "Leadership": ["leadership", "led a team", "team lead", "mentoring", "mentor"],
  "Communication": ["communication", "presentation skills", "public speaking"],
  "Marketing": ["marketing", "campaigns", "go-to-market"],
  "SEO": ["seo"],
  "Copywriting": ["copywriting", "copywriter"],
  "Data analysis": ["data analysis", "analytics", "data analyst"],
  "Customer service": ["customer service", "customer support"],
  "Sales": ["sales", "business development"],
  "Jira": ["jira"],
  "Asana": ["asana"],
  "Frame.io": ["frame.io", "frameio"],
  "Generative AI tools": ["midjourney", "stable diffusion", "runway ml", "generative ai", "ai tools", "firefly"],
};

const STOP = new Set(("a an and are as at be been but by can for from has have in into is it its of on or our that the their them they this to was we were will with you your who what when where which while within would should could about across after all also any both each etc every few more most other over per such than then there these those through under up very via work working team teams role roles job jobs company candidate candidates experience years year strong ability able including include includes well new using use used help helping make making great good plus must required requirements preferred qualifications responsibilities responsible looking join based level like time based day days week weeks month months opportunity environment skills skill knowledge understanding").split(" "));

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function containsTerm(haystackNorm, term) {
  const t = norm(term);
  if (!t) return false;
  // Short aliases (ae, js, c4d) need word boundaries so "ae" doesn't match "aerial".
  const re = new RegExp(`(^|[^a-z0-9])${escapeRe(t)}s?([^a-z0-9]|$)`);
  return re.test(haystackNorm);
}

export function findSkills(text) {
  const h = norm(text);
  const found = [];
  for (const [canon, aliases] of Object.entries(SKILLS)) {
    if ([canon, ...aliases].some((a) => containsTerm(h, a))) found.push(canon);
  }
  return found;
}

// Frequent meaningful 1-3 word phrases from a job description, minus the known skills.
export function topPhrases(text, limit = 25) {
  const words = norm(text).split(" ").filter(Boolean);
  const counts = new Map();
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= words.length; i++) {
      const gram = words.slice(i, i + n);
      if (gram.some((w) => STOP.has(w) || w.length < 3 || /^\d+$/.test(w))) continue;
      const k = gram.join(" ");
      counts.set(k, (counts.get(k) || 0) + (n === 1 ? 1 : 1.6));
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k);
}

// Phrases that make writing read as machine-generated or generic.
export const AI_TELLS = [
  "i am writing to express", "i am excited to apply", "delve", "tapestry", "in today's fast-paced", "fast-paced world",
  "leverage", "synergy", "synergies", "passionate about", "results-driven", "detail-oriented", "team player",
  "go-getter", "think outside the box", "dynamic", "spearheaded", "seamlessly", "cutting-edge", "game-changer",
  "testament to", "elevate", "unlock", "embark", "navigate the", "ever-evolving", "robust", "holistic",
  "i believe i would be a great fit", "perfect fit", "hit the ground running", "wealth of experience",
  "proven track record", "thrive", "at the intersection of", "not only", "i hope this message finds you well",
];

export function findAiTells(text) {
  const h = String(text).toLowerCase();
  const hits = AI_TELLS.filter((p) => h.includes(p));
  const emDashes = (String(text).match(/—/g) || []).length;
  if (emDashes >= 3) hits.push(`${emDashes} em dashes`);
  return hits;
}
