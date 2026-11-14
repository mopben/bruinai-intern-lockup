/**
 * Who is connected, as announced by the server on the control channel.
 * The stage shows "tablet connected", "camera connected" from this.
 */
import { presenceSchema, type RoleCounts } from "./protocol";
import type { MessageLink, Unsubscribe } from "./socket";

export const NO_CLIENTS: RoleCounts = { stage: 0, tablet: 0, camera: 0, other: 0 };

export function watchPresence(
  link: Pick<MessageLink, "subscribe">,
  listener: (roles: RoleCounts) => void,
): Unsubscribe {
  return link.subscribe("control", (payload) => {
    const parsed = presenceSchema.safeParse(payload);
    if (parsed.success) listener(parsed.data.roles);
  });
}
