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
            updated_at: "2026-04-30T04:15:00.000Z",
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
      updatedAt: "2026-04-30T04:15:00.000Z",
      displayDate: "2026-04-30T00:00:00.000Z",
    });
  });

  test("edge release lookup prefers the dedicated edge tag release before scanning prereleases", async () => {
    const requestedUrls: string[] = [];

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
      "edge",
      {
        requestJson: (async <T>(requestUrl: URL) => {
          requestedUrls.push(requestUrl.toString());
          if (requestUrl.pathname.endsWith("/releases/tags/edge")) {
            return {
              tag_name: "edge",
              html_url: "https://github.com/goodguy1963/Copilot-Cockpit/releases/tag/edge",
              draft: false,
              prerelease: true,
              published_at: "2026-04-11T18:00:00.000Z",
              updated_at: "2026-04-30T18:00:00.000Z",
            } as T;
          }

          return [
            {
              tag_name: "v2.0.41-edge.1",
              html_url: "https://github.com/goodguy1963/Copilot-Cockpit/releases/tag/v2.0.41-edge.1",
              draft: false,
              prerelease: true,
              published_at: "2026-04-11T18:00:00.000Z",
              updated_at: "2026-04-12T18:00:00.000Z",
            },
          ] as T;
        }) as <T>(requestUrl: URL, token?: string) => Promise<T>,
      },
    );

    assert.deepStrictEqual(requestedUrls, [
      "https://api.github.com/repos/goodguy1963/Copilot-Cockpit/releases/tags/edge",
    ]);
    assert.deepStrictEqual(releaseInfo, {
      tagName: "edge",
      version: "edge",
      htmlUrl: "https://github.com/goodguy1963/Copilot-Cockpit/releases/tag/edge",
      isDraft: false,
      isPrerelease: true,
      publishedAt: "2026-04-11T18:00:00.000Z",
      updatedAt: "2026-04-30T18:00:00.000Z",
      displayDate: "2026-04-30T18:00:00.000Z",
    });
  });

  test("edge release lookup falls back to prerelease scan when the dedicated edge tag release is unavailable", async () => {
    const requestedUrls: string[] = [];

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
      "edge",
      {
        requestJson: (async <T>(requestUrl: URL) => {
          requestedUrls.push(requestUrl.toString());
          if (requestUrl.pathname.endsWith("/releases/tags/edge")) {
            throw new Error("GitHub request failed (404): Not Found");
          }

          return [
            {
              tag_name: "v2.0.41-edge.1",
              html_url: "https://github.com/goodguy1963/Copilot-Cockpit/releases/tag/v2.0.41-edge.1",
              draft: false,
              prerelease: true,
              published_at: "2026-04-11T18:00:00.000Z",
              updated_at: "2026-04-12T18:00:00.000Z",
            },
            {
              tag_name: "v2.0.60",
              html_url: "https://github.com/goodguy1963/Copilot-Cockpit/releases/tag/v2.0.60",
              draft: false,
              prerelease: false,
              published_at: "2026-04-30T00:00:00.000Z",
              updated_at: "2026-04-30T01:00:00.000Z",
            },
          ] as T;
        }) as <T>(requestUrl: URL, token?: string) => Promise<T>,
      },
    );

    assert.deepStrictEqual(requestedUrls, [
      "https://api.github.com/repos/goodguy1963/Copilot-Cockpit/releases/tags/edge",
      "https://api.github.com/repos/goodguy1963/Copilot-Cockpit/releases?per_page=30",
    ]);
    assert.deepStrictEqual(releaseInfo, {
      tagName: "v2.0.41-edge.1",
      version: "2.0.41-edge.1",
      htmlUrl: "https://github.com/goodguy1963/Copilot-Cockpit/releases/tag/v2.0.41-edge.1",
      isDraft: false,
      isPrerelease: true,
      publishedAt: "2026-04-11T18:00:00.000Z",
      updatedAt: "2026-04-12T18:00:00.000Z",
      displayDate: "2026-04-12T18:00:00.000Z",
    });
  });
});