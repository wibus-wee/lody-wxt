import * as v from 'valibot';

import {
  authDateString,
  nonemptyString,
  positiveInteger,
  secureUrl,
} from '../../shared/infrastructure/http/schemas.js';

export const deviceCodeSchema = v.looseObject({
  device_code: nonemptyString,
  user_code: nonemptyString,
  verification_uri: secureUrl,
  verification_uri_complete: secureUrl,
  expires_in: positiveInteger,
  interval: positiveInteger,
});

export const deviceTokenSchema = v.looseObject({
  access_token: nonemptyString,
  token_type: v.exactOptional(v.string()),
  expires_in: v.exactOptional(positiveInteger),
  scope: v.exactOptional(v.string()),
});

export const accountSchema = v.pipe(
  v.looseObject({
    user: v.looseObject({
      id: nonemptyString,
      email: nonemptyString,
      name: v.exactOptional(v.string()),
      image: v.exactOptional(v.nullable(v.string())),
      emailVerified: v.exactOptional(v.boolean()),
      createdAt: v.exactOptional(authDateString),
      updatedAt: v.exactOptional(authDateString),
    }),
    session: v.looseObject({
      id: nonemptyString,
      userId: nonemptyString,
      expiresAt: authDateString,
      token: v.exactOptional(v.string()),
      createdAt: v.exactOptional(authDateString),
      updatedAt: v.exactOptional(authDateString),
      activeOrganizationId: v.exactOptional(v.nullable(v.string())),
    }),
  }),
  v.check((account) => account.session.userId === account.user.id),
);
