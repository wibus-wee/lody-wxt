const officialOrigins = Object.freeze({
  authOrigin: 'https://backend.lody.ai',
  convexOrigin: 'https://convex.lody.ai',
});

export const officialAccountConfig = Object.freeze({
  authOrigin: officialOrigins.authOrigin,
  clientId: 'lody-cli',
});

export const productConfig = Object.freeze({
  ...officialAccountConfig,
  convexOrigin: officialOrigins.convexOrigin,
});
