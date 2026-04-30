import * as assert from "assert";
import {
  buildGitHubRequestHeaders,
  fetchLatestReleaseInfo,
} from "../../githubReleases";

suite("GitHub release lookup", () => {
  test("public release lookup omits the authorization header and uses the stable release endpoint", async () => {
    const headers = buildGitHubRequestHeaders("");
    let requestedUrl = "";
    let receivedToken = "missing";

    const releaseInfo = await fetchLatestReleaseInfo(
      {
        extension: {
          packageJSON: {
            repository: {
              url: "https://github.com/goodguy1963/Copilot-Cockpit.git",
            },
          },
        },
      },
      "stable",
      {
        requestJson: (async <T>(requestUrl: URL, token?: string) => {
          requestedUrl = requestUrl.toString();
          receivedToken = token ?? "";
          return {
            tag_name: "v2.0.60",
            html_url: "https://github.com/goodguy1963/Copilot-Cockpit/releases/tag/v2.0.60",
            draft: false,
            prerelease: false,
            published_at: "2026-04-30T00:00:00.000Z",
          } as T;
        }) as <T>(requestUrl: URL, token?: string) => Promise<T>,
      },
    );

    assert.deepStrictEqual(headers, {
      Accept: "application/vnd.github+json",
      "User-Agent": "source-scheduler-github-releases",
      "X-GitHub-Api-Version": "2022-11-28",
    });
    assert.strictEqual(receivedToken, "");
    assert.strictEqual(
      requestedUrl,
      "https://api.github.com/repos/goodguy1963/Copilot-Cockpit/releases/latest",
    );
    assert.deepStrictEqual(releaseInfo, {
      tagName: "v2.0.60",
      version: "2.0.60",
      htmlUrl: "https://github.com/goodguy1963/Copilot-Cockpit/releases/tag/v2.0.60",
      isDraft: false,
      isPrerelease: false,
      publishedAt: "2026-04-30T00:00:00.000Z",
    });
  });
});