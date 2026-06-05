function isRendererUrl(url, appUrl) {
  return typeof url === "string" && (url === appUrl || url.startsWith(`${appUrl}#`));
}

function rendererOriginCandidates(appUrl) {
  try {
    const parsedUrl = new URL(appUrl);

    if (parsedUrl.protocol === "file:") {
      return ["file://", "file:///"];
    }

    if (parsedUrl.host) {
      const origin = `${parsedUrl.protocol}//${parsedUrl.host}`;
      return [origin, `${origin}/`];
    }
  } catch {
    return [];
  }

  return [];
}

function isRendererSecurityOrigin(origin, appUrl) {
  return (
    typeof origin === "string" &&
    (rendererOriginCandidates(appUrl).includes(origin) || isRendererUrl(origin, appUrl))
  );
}

function isAuralisMainFramePermissionSource({ appUrl, details, mainWebContents, webContents }) {
  const embeddingOrigin =
    typeof details?.embeddingOrigin === "string" ? details.embeddingOrigin : "";
  const requestingUrl = typeof details?.requestingUrl === "string" ? details.requestingUrl : "";
  const securityOrigin = typeof details?.securityOrigin === "string" ? details.securityOrigin : "";
  const hasTrustedUrl =
    isRendererUrl(requestingUrl, appUrl) || isRendererUrl(embeddingOrigin, appUrl);

  return Boolean(
    mainWebContents &&
      webContents === mainWebContents &&
      details?.isMainFrame === true &&
      hasTrustedUrl &&
      (!securityOrigin || isRendererSecurityOrigin(securityOrigin, appUrl)),
  );
}

function isAuralisMediaPermissionCheck({
  appUrl,
  details,
  mainWebContents,
  permission,
  requestingOrigin,
  webContents,
}) {
  const mediaType = typeof details?.mediaType === "string" ? details.mediaType : "";

  return Boolean(
    isAuralisMainFramePermissionSource({ appUrl, details, mainWebContents, webContents }) &&
      permission === "media" &&
      mediaType !== "video" &&
      (!requestingOrigin || isRendererSecurityOrigin(requestingOrigin, appUrl)),
  );
}

function isAuralisMediaPermissionRequest({
  appUrl,
  details,
  mainWebContents,
  permission,
  webContents,
}) {
  const mediaTypes = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
  const asksForAudio = mediaTypes.length === 0 || mediaTypes.includes("audio");
  const asksForVideo = mediaTypes.includes("video");

  return Boolean(
    isAuralisMainFramePermissionSource({ appUrl, details, mainWebContents, webContents }) &&
      permission === "media" &&
      asksForAudio &&
      !asksForVideo,
  );
}

module.exports = {
  isAuralisMainFramePermissionSource,
  isAuralisMediaPermissionCheck,
  isAuralisMediaPermissionRequest,
  isRendererSecurityOrigin,
  isRendererUrl,
};
