// Local client logo lookup — drop an image (png/jpg/jpeg/webp/svg) into
// src/assets/client-logos/ named after the client, words separated by
// dashes (e.g. "roseville-american-legion.webp"), and it shows up on that
// client's job card automatically. No code changes needed for a new file —
// import.meta.glob picks up anything in the folder at build time.
//
// Matching is word-subset, not exact: the shorter of {filename, job title}
// just has to have all its words appear in the other's words, in whichever
// direction is shorter. That way "roseville-legion.png" matches a job
// titled "Roseville American Legion" and vice versa, without the filename
// needing to match the calendar title verbatim — useful since the same
// client's calendar title can drift slightly over time.
const logoModules = import.meta.glob("./assets/client-logos/*.{png,jpg,jpeg,webp,svg}", { eager: true, import: "default" });

const clientLogos = Object.fromEntries(
  Object.entries(logoModules).map(([path, url]) => {
    const filename = path.split("/").pop().replace(/\.[^.]+$/, "");
    return [filename, url];
  })
);

function slugWords(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 2);
}

export function findClientLogo(jobTitle) {
  const titleWords = new Set(slugWords(jobTitle));
  if (titleWords.size === 0) return null;
  for (const [filename, url] of Object.entries(clientLogos)) {
    const fileWords = slugWords(filename.replace(/-/g, " "));
    if (fileWords.length === 0) continue;
    const smaller = fileWords.length <= titleWords.size ? fileWords : Array.from(titleWords);
    const largerSet = fileWords.length <= titleWords.size ? titleWords : new Set(fileWords);
    if (smaller.every(w => largerSet.has(w))) return url;
  }
  return null;
}
