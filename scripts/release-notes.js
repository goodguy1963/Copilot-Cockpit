const fs = require("fs");
const path = require("path");
const { extractTopChangelogSection } = require("./release-utils");

function fail(message) {
  console.error(message);
  process.exit(1);
}

const changelogPath = path.resolve(process.argv[2] || "CHANGELOG.md");
const outputPath = path.resolve(process.argv[3] || "release-notes.md");

if (!fs.existsSync(changelogPath)) {
  fail(`CHANGELOG not found: ${changelogPath}`);
}

const changelogText = fs.readFileSync(changelogPath, "utf8");
const releaseNotes = extractTopChangelogSection(changelogText);
fs.writeFileSync(outputPath, `${releaseNotes}\n`, "utf8");

console.log(outputPath);