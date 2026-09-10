export class PublishError extends Error {
  constructor(stage, code, details = {}) {
    super(`${stage}: ${code}`);
    this.stage = stage;
    this.code = code;
    this.details = details;
  }
}

const errorTypes = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'URIError', 'EvalError', 'AggregateError', 'TimeoutError', 'AbortError']);
const reasons = new Map([
  ...['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].map((code) => [code, 'TIMEOUT']),
  ...['ENOTFOUND', 'EAI_AGAIN'].map((code) => [code, 'DNS_ERROR']),
  ...['ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT',
    'ERR_SSL_WRONG_VERSION_NUMBER'].map((code) => [code, 'TLS_ERROR']),
  ...['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE',
    'EACCES', 'EPERM', 'ENOENT', 'ENOSPC', 'EBUSY', 'EMFILE'].map((code) => [code, 'PUBLIC_FETCH_FAILED']),
  ['RESPONSE_TOO_LARGE', 'RESPONSE_TOO_LARGE'],
]);
function field(error, key) {
  try { return error?.[key]; } catch { return undefined; }
}

// Fixed allowlists only: error messages, stacks and arbitrary SDK codes may contain secrets.
export function classifyError(error) {
  const name = field(error, 'name');
  const result = { errorType: errorTypes.has(name) ? name : 'UnknownError', publicReason: 'PUBLIC_FETCH_FAILED' };
  for (let depth = 0, current = error; current != null && depth < 4; depth++, current = field(current, 'cause')) {
    const code = field(current, 'code');
    const type = field(current, 'name');
    if (reasons.has(code)) {
      result.errorCode = code;
      result.publicReason = reasons.get(code);
      return result;
    }
    if (type === 'TimeoutError' || type === 'AbortError') {
      result.publicReason = type === 'TimeoutError' ? 'TIMEOUT' : 'ABORTED';
      return result;
    }
  }
  return result;
}
