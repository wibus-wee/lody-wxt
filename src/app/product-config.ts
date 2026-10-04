const officialOrigins = Object.freeze({
  authOrigin: 'https://backend.lody.ai',
  convexOrigin: 'https://convex.lody.ai',
  attachmentOrigin: 'https://api.lody.ai',
});

export const officialAccountConfig = Object.freeze({
  authOrigin: officialOrigins.authOrigin,
  clientId: 'lody-cli',
});

const shareOrigin = import.meta.env.VITE_SESSION_SHARE_ORIGIN?.trim();
const shareApiOrigin = import.meta.env.VITE_SESSION_SHARE_API_ORIGIN?.trim();

export const productConfig = Object.freeze({
  ...officialAccountConfig,
  convexOrigin: officialOrigins.convexOrigin,
  attachmentOrigin: officialOrigins.attachmentOrigin,
  ...(shareOrigin ? { shareOrigin } : {}),
  ...(shareApiOrigin ? { shareApiOrigin } : {}),
});
