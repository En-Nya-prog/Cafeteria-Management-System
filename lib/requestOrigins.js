export function getTrustedOrigins({
  appBaseUrl,
  requestOrigin,
  vercelUrl,
  vercelProjectProductionUrl,
}) {
  const candidates = [
    appBaseUrl,
    requestOrigin,
    vercelUrl && `https://${vercelUrl}`,
    vercelProjectProductionUrl && `https://${vercelProjectProductionUrl}`,
  ];

  return new Set(
    candidates
      .filter(Boolean)
      .map((origin) => new URL(origin).origin)
  );
}
