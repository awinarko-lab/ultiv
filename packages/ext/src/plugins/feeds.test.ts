import { describe, expect, it } from "vite-plus/test";
import { parseFeed } from "./feeds.ts";

describe("parseFeed (RSS 2.0 + Atom, minimal)", () => {
  it("parses RSS items with guid as the natural key", () => {
    const raw = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Deploy 42 &amp; notes</title>
    <guid isPermaLink="false">urn:deploy:42</guid>
    <link>https://example.com/42</link>
    <pubDate>Mon, 26 Oct 2026 03:00:00 GMT</pubDate>
  </item>
  <item>
    <title><![CDATA[CData <title> test]]></title>
    <guid>urn:deploy:43</guid>
  </item>
</channel></rss>`;
    const items = parseFeed(raw);
    expect(items).toHaveLength(2);
    expect(items[0]?.uid).toBe("urn:deploy:42");
    expect(items[0]?.title).toBe("Deploy 42 & notes");
    expect(items[0]?.link).toBe("https://example.com/42");
    expect(items[0]?.pubAt).not.toBeNull();
    expect(items[1]?.title).toBe("CData <title> test");
  });

  it("parses Atom entries with id and href links", () => {
    const raw = `<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>tag:example.com,2026:post-1</id>
    <title>Hello</title>
    <link rel="alternate" href="https://example.com/post-1"/>
    <published>2026-10-26T00:00:00Z</published>
  </entry>
</feed>`;
    const items = parseFeed(raw);
    expect(items).toHaveLength(1);
    expect(items[0]?.uid).toBe("tag:example.com,2026:post-1");
    expect(items[0]?.link).toBe("https://example.com/post-1");
    expect(items[0]?.pubAt).not.toBeNull();
  });

  it("never throws on garbage — empty output means nothing new", () => {
    expect(parseFeed("this is not xml")).toEqual([]);
    expect(parseFeed("")).toEqual([]);
  });
});
