// Internal bridge entry shared with engine builds and protocol verification.
export {
  BridgeError,
  DATA_PROTOCOL,
  decodeBinary,
  encodeBinary,
  MAX_BINARY_BYTES,
  MAX_MESSAGE_BYTES,
  parseMessage,
  record,
  stringifyMessage,
  validDocumentId,
} from './documents/infrastructure/wire.js';
