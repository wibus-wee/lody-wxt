import * as v from 'valibot';

import type { HttpClient } from '../../shared/infrastructure/http/http-client.js';
import {
  nonemptyString,
  parseResponse,
  positiveInteger,
  secureBaseUrl,
} from '../../shared/infrastructure/http/schemas.js';
import type { GrantOptions, StreamsGrantGateway } from '../application/ports.js';
import type { StreamsGrant } from '../domain/models.js';

const shardLabelPattern = /^[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?$/i;
const shardHost = v.pipe(
  v.string(),
  v.maxLength(253),
  v.check(
    (value) =>
      value.split('.').length >= 2 &&
      value.split('.').every((label) => shardLabelPattern.test(label)),
  ),
);
const grantSchema = v.looseObject({
  token: nonemptyString,
  expiresIn: positiveInteger,
  gatewayBaseUrl: v.exactOptional(secureBaseUrl),
  shardHostSuffix: v.exactOptional(shardHost),
});

export class HttpStreamsGrantGateway implements StreamsGrantGateway {
  constructor(private readonly http: HttpClient) {}

  async getGrant(
    credential: string,
    workspaceId: string,
    options: GrantOptions,
  ): Promise<StreamsGrant> {
    const { data } = await this.http.request(
      '/api/loro-streams/token',
      {
        workspaceId,
        ...(options.rejectedToken === undefined ? {} : { rejectedToken: options.rejectedToken }),
      },
      credential,
      options,
    );
    return parseResponse(grantSchema, data);
  }
}
