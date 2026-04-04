const fs = require("fs");
const path = require("path");

const workspaceRoot = process.cwd();
const sourcePath = path.join(workspaceRoot, "node_modules", "sql.js", "dist", "sql-wasm.wasm");
const targetPath = path.join(workspaceRoot, "out", "sql-wasm.wasm");

if (!fs.existsSync(sourcePath)) {
  throw new Error(`sql-wasm.wasm was not found at ${sourcePath}`);
}

fs.mkdirSync(path.dirname(targetPath), { recursive: true });
fs.copyFileSync(sourcePath, targetPath);

console.log(targetPath);
