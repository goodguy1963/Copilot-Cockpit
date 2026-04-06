const fs = require("fs");
const path = require("path");
const { extractTopChangelogSection } = require("./release-utils");

const changelogPath = path.resolve(process.argv[2] || "CHANGELOG.md");
const outputPath = path.resolve(process.argv[3] || "release-notes.md");

let releaseNotes;
if (!fs.existsSync(changelogPath)) {
  releaseNotes = "Release notes unavailable: CHANGELOG.md was not found for this build.";
} else {
  const changelogText = fs.readFileSync(changelogPath, "utf8");
  releaseNotes = extractTopChangelogSection(changelogText);
}
fs.writeFileSync(outputPath, `${releaseNotes}\n`, "utf8");

console.log(outputPath);