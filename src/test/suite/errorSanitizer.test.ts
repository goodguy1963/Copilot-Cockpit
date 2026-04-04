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

  test("returns an empty string unchanged", () => {
    assert.strictEqual(sanitizeAbsolutePathDetails(""), "");
  });

  test("does not touch relative paths", () => {
    const message = "Error in src/utils/helper.ts at line 42";

    assert.strictEqual(sanitizeAbsolutePathDetails(message), message);
  });

  test("sanitizes multiple Windows paths in a single message", () => {
    const message = 'Error reading "C:\\repo\\a.ts" and writing "D:\\other\\b.ts"';
    const sanitized = sanitizeAbsolutePathDetails(message);

    assert.ok(sanitized.includes('"a.ts"'), `Expected 'a.ts' in: ${sanitized}`);
    assert.ok(sanitized.includes('"b.ts"'), `Expected 'b.ts' in: ${sanitized}`);
    assert.ok(!sanitized.includes("C:\\repo"), `Did not expect full path in: ${sanitized}`);
    assert.ok(!sanitized.includes("D:\\other"), `Did not expect full path in: ${sanitized}`);
  });
});