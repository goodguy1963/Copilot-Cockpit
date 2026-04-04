import * as assert from "assert";
import { sanitizeAbsolutePathDetails } from "../../errorSanitizer";

suite("Error Sanitizer Unit Tests", () => {
  test("sanitizes quoted Windows, POSIX, UNC, and file URI paths to basenames", () => {
    const message = [
      'Failure at "C:\\repo\\src\\index.ts"',
      "and '/repo/src/app.ts'",
      "and \\\\server\\share\\folder\\note.md",
      "and file:///C:/repo/src/file.ts",
      "and file:///repo/src/other.ts",
    ].join(" ");

    const sanitized = sanitizeAbsolutePathDetails(message);

    assert.ok(sanitized.includes('"index.ts"'));
    assert.ok(sanitized.includes("'app.ts'"));
    assert.ok(sanitized.includes("note.md"));
    assert.ok(sanitized.includes("file.ts"));
    assert.ok(sanitized.includes("other.ts"));
    assert.ok(!sanitized.includes("C:\\repo\\src\\index.ts"));
    assert.ok(!sanitized.includes("/repo/src/app.ts"));
    assert.ok(!sanitized.includes("file:///C:/repo/src/file.ts"));
  });

  test("leaves non-path messages unchanged", () => {
    const message = "Validation failed for task input";

    assert.strictEqual(sanitizeAbsolutePathDetails(message), message);
  });
});