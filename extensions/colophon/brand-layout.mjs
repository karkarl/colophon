export const FOUNDATION_SECTIONS = Object.freeze([
  { id: "colors", label: "Color" },
  { id: "typography", label: "Typography" },
  { id: "spacing", label: "Spacing" },
  { id: "radii", label: "Radii" },
  { id: "shadows", label: "Shadows" },
  { id: "principles", label: "Principles" },
]);

const isCustomPage = (page) => page && !["brand", "components", "configuration"].includes(page.id);

export function validateBrandLayout(tokens) {
  const errors = [];
  const hero = tokens?.brand?.hero;
  if (hero != null) {
    if (typeof hero !== "object" || Array.isArray(hero)) errors.push("brand.hero must be an object.");
    else {
      if (typeof hero.html !== "string") errors.push("brand.hero.html must be a string.");
      if (hero.title !== undefined && (typeof hero.title !== "string" || !hero.title.trim())) {
        errors.push("brand.hero.title must be a non-empty accessible name.");
      }
      if (hero.height !== undefined && (!Number.isInteger(hero.height) || hero.height < 80 || hero.height > 1200)) {
        errors.push("brand.hero.height must be an integer between 80 and 1200 pixels.");
      }
    }
  }
  const homes = new Set();
  for (const page of Array.isArray(tokens?.pages) ? tokens.pages : []) {
    if (!page || !Object.hasOwn(page, "sections")) continue;
    if (!isCustomPage(page)) errors.push(`Page "${page.id}" cannot contain foundation sections; use a custom page.`);
    if (!Array.isArray(page.sections)) {
      errors.push(`Page "${page.id}" sections must be an array.`);
      continue;
    }
    for (const id of page.sections) {
      if (!FOUNDATION_SECTIONS.some((section) => section.id === id)) errors.push(`Unknown foundation section: "${String(id)}".`);
      else if (homes.has(id)) errors.push(`Foundation section "${id}" has more than one placement.`);
      homes.add(id);
    }
  }
  return errors;
}

export function foundationHome(tokens, id) {
  return (Array.isArray(tokens.pages) ? tokens.pages : [])
    .find((page) => isCustomPage(page) && Array.isArray(page.sections) && page.sections.includes(id))?.id || "brand";
}

export function foundationSectionsForPage(tokens, pageId) {
  if (pageId === "brand") return FOUNDATION_SECTIONS.filter(({ id }) => foundationHome(tokens, id) === "brand").map(({ id }) => id);
  return (Array.isArray(tokens.pages) ? tokens.pages : []).find((page) => page?.id === pageId)?.sections || [];
}

export function moveFoundationSection(tokens, id, targetId) {
  const errors = validateBrandLayout(tokens);
  if (errors.length) throw new Error(errors.join(" "));
  if (!FOUNDATION_SECTIONS.some((section) => section.id === id)) throw new Error("Unknown foundation section.");
  const pages = Array.isArray(tokens.pages) ? tokens.pages : [];
  const target = pages.find((page) => isCustomPage(page) && page.id === targetId);
  if (targetId !== "brand" && !target) throw new Error("The destination page no longer exists.");
  if (foundationHome(tokens, id) === targetId) return false;
  for (const page of pages) {
    if (Array.isArray(page.sections) && page.sections.includes(id)) page.sections = page.sections.filter((section) => section !== id);
  }
  if (target) target.sections = [...(target.sections || []), id];
  return true;
}

export function heroDocument(html, tokenCss = "") {
  // The host also applies sandbox="allow-scripts" without same-origin permission.
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https:; img-src https: data: blob:; media-src https: data: blob:; font-src https: data:; frame-src https:; connect-src 'none'; form-action 'none'; base-uri 'none'";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>${tokenCss.replace(/<\/style/gi, "<\\/style")}
html,body{margin:0;min-height:100%;background:var(--color-paper);color:var(--color-ink);font-family:var(--font-body)}
*,*::before,*::after{box-sizing:border-box}
img,video,svg,canvas{max-width:100%}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
</style></head><body>${html}</body></html>`;
}
