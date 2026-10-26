/**
 * Feed item parsing: RSS 2.0 and Atom, minimal — the stable item identity
 * (`guid` / `id`), title, link and publish time. Regex over the raw XML on
 * purpose: sensors need four fields, not a DOM. Malformed feeds yield what
 * they yield; the sensor poller treats empty output as "nothing new", never
 * as an error.
 */

export interface FeedItem {
  /** Stable identity: RSS `guid` or Atom `id`. Falls back to title+pubAt. */
  readonly uid: string | null;
  readonly title: string;
  readonly link: string | null;
  readonly pubAt: number | null;
}

const decode = (text: string): string =>
  text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

const pick = (block: string, tag: string): string | null => {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  return match === null ? null : decode(match[1]?.trim() ?? "");
};

/** Atom puts the link in an attribute: <link href="…" rel="alternate" …/> */
const pickHref = (block: string): string | null => {
  for (const match of block.matchAll(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    const rel = /rel=["']([^"']+)["']/i.exec(match[0] ?? "")?.[1] ?? "alternate";
    if (rel === "alternate") return decode(match[1] ?? "");
  }
  return null;
};

const blocks = (raw: string, tag: "item" | "entry"): string[] => {
  const out: string[] = [];
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, "gi");
  for (const match of raw.matchAll(pattern)) out.push(match[0] ?? "");
  return out;
};

/** Parse an RSS 2.0 or Atom document into feed items (document order). */
export const parseFeed = (raw: string): readonly FeedItem[] => {
  const items: FeedItem[] = [];
  const atom = /<feed[\s>]/i.test(raw);
  for (const block of blocks(raw, atom ? "entry" : "item")) {
    const title = pick(block, "title") ?? "(untitled)";
    const uid = pick(block, atom ? "id" : "guid") ?? pickHref(block) ?? pick(block, "link");
    const link = pickHref(block) ?? pick(block, "link");
    const pubRaw = pick(block, atom ? "published" : "pubDate") ?? pick(block, "updated");
    const parsed = pubRaw !== null ? new Date(pubRaw).getTime() : Number.NaN;
    items.push({
      uid,
      title,
      link,
      pubAt: Number.isNaN(parsed) ? null : parsed,
    });
  }
  return items;
};
