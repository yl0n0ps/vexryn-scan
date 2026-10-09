// Posting the review event to Vexryn Cloud. Only when VEXRYN_ORG_TOKEN is set;
// the token goes in the Authorization header, never in the URL or the body.
import type { ReviewEvent } from "./events.js";

export const DEFAULT_CLOUD_URL = "https://app.vexryn.com"; // founder confirms the domain before 0.5.0 ships

export async function postReview(
  event: ReviewEvent,
  opts: { url: string; token: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetchImpl(`${opts.url.replace(/\/$/, "")}/v1/reviews`, {
      method: "POST",
      headers: { authorization: `Bearer ${opts.token}`, "content-type": "application/json", "user-agent": `vexryn/${event.cli}` },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
}
