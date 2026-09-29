// Local per-client asset lookups — drop an image into the matching
// src/assets/client-*/ folder, named after the client (words separated by
// dashes, e.g. "roseville-american-legion.webp"), and it shows up on that
// client's job card automatically. No code changes needed for a new file —
// import.meta.glob picks up anything already in the folder at build time.
//
// Matching is word-subset, not exact — see matchClientAsset — so a
// filename doesn't need to equal the calendar title verbatim.

function slugWords(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 2);
}

// Builds a { filenameWithoutExt: url } map from an import.meta.glob result
// keyed by full module path.
function buildAssetMap(modules) {
  return Object.fromEntries(
    Object.entries(modules).map(([path, url]) => {
      const filename = path.split("/").pop().replace(/\.[^.]+$/, "");
      return [filename, url];
    })
  );
}

// The shorter of {filename, job title} just needs all its words present in
// the other's words, in whichever direction is shorter — so
// "roseville-american-legion.webp" matches a job titled "Roseville Legion"
// and vice versa, without the filename needing to match the calendar
// title verbatim (useful since the same client's calendar title can drift
// slightly over time).
function matchClientAsset(assetMap, jobTitle) {
  const titleWords = new Set(slugWords(jobTitle));
  if (titleWords.size === 0) return null;
  for (const [filename, url] of Object.entries(assetMap)) {
    const fileWords = slugWords(filename.replace(/-/g, " "));
    if (fileWords.length === 0) continue;
    const smaller = fileWords.length <= titleWords.size ? fileWords : Array.from(titleWords);
    const largerSet = fileWords.length <= titleWords.size ? titleWords : new Set(fileWords);
    if (smaller.every(w => largerSet.has(w))) return url;
  }
  return null;
}

// src/assets/client-logos/*.{png,jpg,jpeg,webp,svg} — the client's own
// business logo, shown next to their name on the job card.
const logoModules = import.meta.glob("./assets/client-logos/*.{png,jpg,jpeg,webp,svg}", { eager: true, import: "default" });
const clientLogos = buildAssetMap(logoModules);
export function findClientLogo(jobTitle) {
  return matchClientAsset(clientLogos, jobTitle);
}

// src/assets/client-taps/*.{png,jpg,jpeg,webp} — a reference photo of the
// client's actual tap tower/lines, so what's on tap and the line layout is
// visible before walking in, alongside (not instead of) the Street View
// photo that's there for finding the building itself.
const tapModules = import.meta.glob("./assets/client-taps/*.{png,jpg,jpeg,webp}", { eager: true, import: "default" });
const clientTapPhotos = buildAssetMap(tapModules);
export function findClientTapPhoto(jobTitle) {
  return matchClientAsset(clientTapPhotos, jobTitle);
}

// src/assets/course-backgrounds/*.{png,jpg,jpeg,webp} — a hand-picked photo
// for a golf course's background in GolfScorecard.jsx, checked before that
// page's live Wikimedia Commons search (see fetchCourseBackground there) —
// a course with a file here always wins over the live search, no live
// search is even attempted for it.
const courseBgModules = import.meta.glob("./assets/course-backgrounds/*.{png,jpg,jpeg,webp}", { eager: true, import: "default" });
const courseBackgrounds = buildAssetMap(courseBgModules);
export function findCourseBackground(courseName) {
  return matchClientAsset(courseBackgrounds, courseName);
}
