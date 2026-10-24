import { execFileSync } from "node:child_process";

// Sports data commits must deploy immediately. Only social-post bookkeeping
// can be skipped; those files do not supply the site's current data boards.
const skipped = new Set([
  "Automated X posting update",
  "Build Called It X dry-run queue",
  "Build daily edge X post outputs",
  "Build daily slate X thread preview"
]);
let subject = process.env.VERCEL_GIT_COMMIT_MESSAGE?.split("\n", 1)[0]?.trim();
if (!subject) {
  try { subject = execFileSync("git", ["log", "-1", "--pretty=%s"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { process.exit(1); }
}
console.log(skipped.has(subject) ? "Skipping social bookkeeping build" : "Publishing latest site and sports data");
// Vercel's ignore command uses zero to skip, one to build.
process.exit(skipped.has(subject) ? 0 : 1);
