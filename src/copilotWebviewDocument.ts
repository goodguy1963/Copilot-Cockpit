import { escapeHtmlAttr } from "./copilotWebviewContentUtils";

type RenderSchedulerWebviewDocumentParams = {
  uiLanguage: string;
  cspSource: string;
  nonce: string;
  title: string;
  documentContent: string;
  initialDataJson: string;
  scriptUri: string;
};

export function renderSchedulerWebviewDocument(
  params: RenderSchedulerWebviewDocumentParams,
): string {
  return `<!DOCTYPE html>
<html lang="${params.uiLanguage}">
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${params.cspSource} 'unsafe-inline'; script-src 'nonce-${params.nonce}'; img-src ${params.cspSource}; font-src ${params.cspSource};">
  <title>${escapeHtmlAttr(params.title)}</title>
${params.documentContent}
  <script nonce="${params.nonce}" id="initial-data" type="application/json">${params.initialDataJson}</script>

  <script nonce="${params.nonce}" src="${params.scriptUri}"></script>
</body>
</html>`;
}
