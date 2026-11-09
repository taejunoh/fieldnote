function parseHttpUrl(value: string | undefined): URL | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isUnspecifiedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "0.0.0.0" || host === "::";
}

export function getAuthCallbackOrigin(
  requestUrl: string,
  appUrl = process.env.APP_URL,
  nodeEnv = process.env.NODE_ENV,
): string {
  const isProduction = nodeEnv === "production";
  const configuredUrl = parseHttpUrl(appUrl);

  if (
    configuredUrl &&
    (!isProduction ||
      (configuredUrl.protocol === "https:" &&
        !isLocalHost(configuredUrl.hostname) &&
        !isUnspecifiedHost(configuredUrl.hostname)))
  ) {
    return configuredUrl.origin;
  }

  if (!isProduction) {
    const request = parseHttpUrl(requestUrl);
    if (request && isLocalHost(request.hostname)) return request.origin;
  }

  throw new Error("APP_URL must be configured with a valid canonical application URL");
}
