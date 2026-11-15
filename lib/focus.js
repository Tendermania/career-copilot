// Career focuses: a library of presets plus resume-based suggestions.
// A focus drives job search roles, ATS keywords, AI writing context and the default
// example text shown across the app.

const H = (o) => o; // readability

export const PRESETS = [
  {
    id: "motion", label: "Motion graphics",
    roles: ["Motion Designer", "Motion Graphics Designer", "Animator", "2D/3D Motion Designer", "Video Editor"],
    keywords: ["After Effects", "Cinema 4D", "Rive", "Lottie", "Illustrator", "Photoshop", "Premiere Pro"],
    industries: ["tech", "games", "broadcast", "advertising"],
    match: ["motion graphics", "motion design", "after effects", "rive", "lottie", "animation", "animator", "kinetic", "cinema 4d", "blender", "compositing"],
    hints: H({
      headline: "Motion Designer · 2D/3D · Rive & Lottie", craft: "Your craft. E.g. 2D/3D motion for brands and products, UI animation in Rive, editing.",
      aboutExample: "- started in graphic design, moved to motion in 2019\n- love UI animation, did the Rive onboarding for X\n- want a small in-house team, remote",
      resumeName: "Motion resume 2026", jobTitle: "Motion Designer", filter: "e.g. Rive, games, NYC", recipient: "Sam Lee, Motion Lead at Duolingo",
      proof: "A showreel or portfolio link, shipped product/brand animations, tools used, and measurable outcomes (engagement, conversion, turnaround time).",
      sources: "Motionographer jobs, School of Motion job board, ProductionHUB, Mandy, Working Not Working, Dribbble jobs, Behance jobs, Creativepool, Krop",
    }),
  },
  {
    id: "social", label: "Social media marketing",
    roles: ["Social Media Manager", "Social Media Marketing Specialist", "Content Creator", "Community Manager", "Short-form Video Producer", "Social Media Coordinator"],
    keywords: ["TikTok", "Instagram", "Reels", "Content strategy", "Community management", "Analytics", "Meta Business Suite", "CapCut", "Canva", "Engagement rate"],
    industries: ["consumer brands", "gaming", "creator economy", "SaaS", "ecommerce"],
    match: ["social media", "tiktok", "instagram", "content creator", "community", "organic growth", "engagement", "ugc", "campaign", "followers", "reels", "influencer"],
    hints: H({
      headline: "Social Media Marketer · Short-form video · Organic growth & community", craft: "Your craft. E.g. short-form content strategy, TikTok/Reels growth, community management, campaign analytics.",
      aboutExample: "- started posting for a small brand, grew its TikTok to 50k\n- love short-form video and trend analysis\n- want an in-house brand/social team, remote",
      resumeName: "Social media resume 2026", jobTitle: "Social Media Manager", filter: "e.g. TikTok, community, gaming", recipient: "Sam Lee, Head of Social at Glossier",
      proof: "Numbers: follower growth, views, engagement rate, sign-ups or sales driven, campaign results, posting cadence, and the platforms and tools used.",
      sources: "Social Media Today jobs, Mediabistro, Working Not Working, WeWorkRemotely marketing, Wellfound, LinkedIn, creator-economy and brand newsletters",
    }),
  },
  {
    id: "uxui", label: "UI/UX & interaction design",
    roles: ["Interaction Designer", "Product Designer", "UI Designer", "UX Designer", "UI Animator", "Motion Designer (Product)"],
    keywords: ["Figma", "Prototyping", "Micro-interactions", "Design systems", "User research", "Rive", "Wireframes", "Usability testing"],
    industries: ["SaaS", "fintech", "health tech", "edtech"],
    match: ["ui/ux", "ux design", "ui design", "interaction design", "interaction designer", "figma", "prototype", "micro interaction", "micro-interaction", "user research", "usability", "wireframe", "design system", "product design"],
    hints: H({
      headline: "Interaction Designer · Product UI · Micro-interactions & prototyping", craft: "Your craft. E.g. interaction and UI design, prototyping in Figma/Rive, user research, design systems.",
      aboutExample: "- designed and animated onboarding flows for a SaaS app\n- love micro-interactions and usability testing\n- want a product team that ships quickly, remote",
      resumeName: "UX / interaction resume 2026", jobTitle: "Interaction Designer", filter: "e.g. Figma, SaaS, fintech", recipient: "Sam Lee, Design Lead at Linear",
      proof: "Case studies with the problem, your role, the process and the outcome: usability results, conversion or engagement changes, and what shipped.",
      sources: "Dribbble jobs, Built In, Wellfound, Otta, Designer News jobs, Remote Rocketship, LinkedIn",
    }),
  },
  {
    id: "graphic", label: "Graphic design & branding",
    roles: ["Graphic Designer", "Brand Designer", "Visual Designer", "Marketing Designer", "Illustrator", "Packaging Designer"],
    keywords: ["Illustrator", "Photoshop", "InDesign", "Brand identity", "Typography", "Logo design", "Layout", "Figma", "Print"],
    industries: ["agencies", "consumer brands", "food & beverage", "nonprofit"],
    match: ["graphic design", "branding", "brand identity", "logo", "typography", "illustrator", "photoshop", "indesign", "packaging", "poster", "layout", "visual design"],
    hints: H({
      headline: "Graphic Designer · Branding & visual identity · Illustrator & Photoshop", craft: "Your craft. E.g. brand identities, logos, packaging and campaign graphics.",
      aboutExample: "- studied art, started with local logos and posters\n- love typography and brand systems\n- want an in-house brand team or a creative studio",
      resumeName: "Graphic design resume 2026", jobTitle: "Graphic Designer", filter: "e.g. packaging, branding, Denver", recipient: "Sam Lee, Creative Director at Mailchimp",
      proof: "Portfolio pieces with the brief, your role, the finished work and any result (sales, recognition, adoption). Name the clients and tools.",
      sources: "Creativepool, Dribbble jobs, Behance jobs, AIGA design jobs, Krop, Working Not Working, LinkedIn",
    }),
  },
  {
    id: "video", label: "Video editing & production",
    roles: ["Video Editor", "Video Producer", "Content Producer", "Post-Production Editor", "Videographer", "Short-form Video Editor"],
    keywords: ["Premiere Pro", "DaVinci Resolve", "Final Cut", "After Effects", "Color grading", "Sound design", "YouTube", "Storytelling"],
    industries: ["media", "creator economy", "advertising", "corporate video"],
    match: ["video editing", "video editor", "premiere", "davinci", "final cut", "color grading", "youtube", "videograph", "post-production", "filmmak", "video art"],
    hints: H({
      headline: "Video Editor · Short-form & brand video · Premiere & After Effects", craft: "Your craft. E.g. editing short-form and brand video, motion titles, color and sound.",
      aboutExample: "- started editing for YouTube creators\n- love pacing, sound design and story\n- want a content team with steady work, remote",
      resumeName: "Video editing resume 2026", jobTitle: "Video Editor", filter: "e.g. YouTube, short-form, documentary", recipient: "Sam Lee, Head of Video at Vox",
      proof: "A reel, view counts or retention results, formats you edit (long-form, shorts, ads), turnaround speed and the tools you use.",
      sources: "Mandy, ProductionHUB, Working Not Working, Staff Me Up, YouTube creator job boards, LinkedIn",
    }),
  },
  {
    id: "content", label: "Content & copywriting",
    roles: ["Content Writer", "Copywriter", "Content Marketing Specialist", "Content Strategist", "Brand Writer", "Newsletter Writer"],
    keywords: ["Copywriting", "SEO", "Content strategy", "Editing", "Brand voice", "Email marketing", "CMS", "Analytics"],
    industries: ["SaaS", "agencies", "media", "ecommerce"],
    match: ["copywriting", "copywriter", "content writer", "content marketing", "blog", "newsletter", "seo", "editorial", "brand voice", "ghostwrit"],
    hints: H({
      headline: "Copywriter · Content strategy · SEO & brand voice", craft: "Your craft. E.g. website and email copy, long-form content, SEO writing and brand voice.",
      aboutExample: "- wrote for a campus magazine, then freelance blogs\n- love clear, specific writing\n- want a content team in SaaS, remote",
      resumeName: "Content writing resume 2026", jobTitle: "Content Writer", filter: "e.g. SEO, B2B SaaS, email", recipient: "Sam Lee, Head of Content at HubSpot",
      proof: "Published links, traffic or conversion results, word counts and formats, industries written for and the tools used.",
      sources: "ProBlogger jobs, Superpath, Contently, WeWorkRemotely copywriting, Wellfound, LinkedIn",
    }),
  },
  {
    id: "marketing", label: "Digital marketing & growth",
    roles: ["Digital Marketing Specialist", "Growth Marketer", "Marketing Coordinator", "Performance Marketing Specialist", "Email Marketing Specialist", "Marketing Associate"],
    keywords: ["Google Analytics", "Meta Ads", "Google Ads", "Email marketing", "A/B testing", "SEO", "HubSpot", "Funnels", "Campaign management"],
    industries: ["SaaS", "ecommerce", "agencies", "startups"],
    match: ["digital marketing", "growth", "performance marketing", "google ads", "meta ads", "email marketing", "a/b test", "analytics", "campaign", "funnel", "seo", "conversion"],
    hints: H({
      headline: "Digital Marketer · Growth campaigns · Analytics & experimentation", craft: "Your craft. E.g. campaign management, paid and organic growth, email, analytics and testing.",
      aboutExample: "- started in social, moved into growth experiments\n- love testing and reading the data\n- want a small marketing team, remote",
      resumeName: "Marketing resume 2026", jobTitle: "Digital Marketing Specialist", filter: "e.g. growth, Meta Ads, SaaS", recipient: "Sam Lee, Head of Growth at Notion",
      proof: "Results with numbers: sign-ups, revenue, CAC/ROAS, conversion lift, test wins, budgets handled and the tools used.",
      sources: "Growth.Design jobs, GrowthHackers, Marketing Hire, Wellfound, WeWorkRemotely marketing, LinkedIn",
    }),
  },
  {
    id: "web", label: "Web design & front-end",
    roles: ["Web Designer", "Front-end Developer", "Webflow Developer", "Creative Developer", "Framer Designer", "UI Developer"],
    keywords: ["Webflow", "Framer", "HTML", "CSS", "JavaScript", "Figma", "Responsive design", "GSAP", "WordPress"],
    industries: ["agencies", "startups", "ecommerce"],
    match: ["web design", "webflow", "framer", "front-end", "frontend", "html", "css", "javascript", "wordpress", "responsive", "gsap", "website"],
    hints: H({
      headline: "Web Designer · Webflow & Framer · Interactive sites", craft: "Your craft. E.g. designing and building marketing sites in Webflow/Framer, animation on the web.",
      aboutExample: "- self-taught web design, built sites for local businesses\n- love interactive, animated sites\n- want an agency or product team, remote",
      resumeName: "Web design resume 2026", jobTitle: "Web Designer", filter: "e.g. Webflow, Framer, agency", recipient: "Sam Lee, Design Lead at Webflow",
      proof: "Live site links, the brief, your role, performance or conversion results, and the stack used.",
      sources: "Webflow jobs, Awwwards jobs, Dribbble jobs, WeWorkRemotely design, Wellfound, LinkedIn",
    }),
  },
  {
    id: "qa", label: "QA & user testing",
    roles: ["QA Tester", "User Acceptance Tester", "QA Analyst", "Usability Tester", "Game Tester", "Product Support Specialist"],
    keywords: ["Bug reporting", "Test cases", "Edge-case testing", "Jira", "UAT", "Regression testing", "Usability testing"],
    industries: ["SaaS", "games", "ecommerce"],
    match: ["user acceptance testing", "uat", "bug", "qa", "test cases", "edge-case", "regression", "usability testing", "tester"],
    hints: H({
      headline: "QA Tester · UAT & edge-case testing · Clear bug reports", craft: "Your craft. E.g. user acceptance testing, finding edge-case defects and writing clear bug reports.",
      aboutExample: "- tested web apps remotely, found edge-case bugs\n- love breaking things in creative ways\n- want a product team that values quality, remote",
      resumeName: "QA resume 2026", jobTitle: "QA Tester", filter: "e.g. UAT, Jira, games", recipient: "Sam Lee, QA Lead at Riot Games",
      proof: "Defects found, test coverage, tools (Jira, TestRail), products tested and how fixes were verified.",
      sources: "Ministry of Testing jobs, Wellfound, WeWorkRemotely, Remote OK, LinkedIn",
    }),
  },
  {
    id: "illustration", label: "Illustration & character design",
    roles: ["Illustrator", "Character Designer", "Storyboard Artist", "2D Artist", "Concept Artist"],
    keywords: ["Illustrator", "Procreate", "Photoshop", "Character design", "Storyboarding", "Vector art", "Concept art"],
    industries: ["games", "publishing", "animation studios", "advertising"],
    match: ["illustrat", "character design", "storyboard", "procreate", "concept art", "drawing", "vector"],
    hints: H({
      headline: "Illustrator · Character design · Storyboards", craft: "Your craft. E.g. character design, editorial illustration, storyboards.",
      aboutExample: "- studied drawing for animation\n- love character design and storytelling\n- want a studio or game team, remote",
      resumeName: "Illustration resume 2026", jobTitle: "Illustrator", filter: "e.g. character, games, children's", recipient: "Sam Lee, Art Director at Riot Games",
      proof: "A focused portfolio, published or shipped work, clients, style range and turnaround.",
      sources: "ArtStation jobs, Creativepool, Working Not Working, Dribbble jobs, Behance jobs, LinkedIn",
    }),
  },
];

export const presetById = (id) => PRESETS.find((p) => p.id === id);
export const toFocus = (p, extra = {}) => ({ id: `${p.id}-${Math.random().toString(36).slice(2, 7)}`, label: p.label, roles: [...p.roles], keywords: [...p.keywords], avoidKeywords: [], industries: [...(p.industries || [])], seniority: "", hints: { ...p.hints }, ...extra });

const esc = (w) => w.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Score every preset against resume text. No AI needed. */
export function suggestFromText(text = "") {
  const t = ` ${String(text).toLowerCase()} `;
  const out = [];
  for (const p of PRESETS) {
    const hits = [];
    let score = 0;
    for (const term of p.match) {
      const n = (t.match(new RegExp(`(?<![a-z])${esc(term)}`, "g")) || []).length;
      if (n) { hits.push(term); score += Math.min(n, 4); }
    }
    if (hits.length) out.push({ preset: p, score, hits });
  }
  return out.sort((a, b) => b.score - a.score);
}
