/**
 * Correlation ids — an adapter-framework concern shared by every channel.
 *
 * A `request_id` is minted for each inbound message and threaded through the
 * injection header, the reply command, the bus envelope, and the per-request
 * reply-target store, so concurrent conversations never cross. Channel adapters
 * call newRequestId(); the format is opaque on purpose.
 */
export function newRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Extract the `[req:<id>]` token from a rendered injection header, if present. */
export function parseRequestId(headerOrText: string): string | undefined {
  return headerOrText.match(/\[req:([^\]]+)\]/)?.[1];
}
