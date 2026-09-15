import { useEffect } from "react";

interface SeoTags {
  title: string;
  description: string;
  canonical: string;
  ogImage: string;
}

/** Set or create a <meta name|property="..."> tag with the given content. */
function upsertMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(
    `meta[${attr}="${key}"]`,
  );
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

/**
 * Minimal document-head updater (~30 lines) — no react-helmet dependency.
 * Sets title, description, canonical, OG/Twitter tags, and one JSON-LD block.
 * Cleans up the JSON-LD node on unmount/route change.
 */
export function useSeo(tags: SeoTags, jsonLd: Record<string, unknown>) {
  const jsonLdText = JSON.stringify(jsonLd);
  useEffect(() => {
    document.title = tags.title;
    upsertMeta("name", "description", tags.description);
    upsertMeta("name", "robots", "index, follow");

    let canonical =
      document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.setAttribute("rel", "canonical");
      document.head.appendChild(canonical);
    }
    canonical.setAttribute("href", tags.canonical);

    upsertMeta("property", "og:type", "article");
    upsertMeta("property", "og:site_name", "AlgoTheseus");
    upsertMeta("property", "og:title", tags.title);
    upsertMeta("property", "og:description", tags.description);
    upsertMeta("property", "og:url", tags.canonical);
    upsertMeta("property", "og:image", tags.ogImage);
    upsertMeta("name", "twitter:card", "summary_large_image");
    upsertMeta("name", "twitter:title", tags.title);
    upsertMeta("name", "twitter:description", tags.description);
    upsertMeta("name", "twitter:image", tags.ogImage);

    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.dataset.seoJsonLd = "visualize";
    script.textContent = jsonLdText;
    document.head.appendChild(script);
    return () => {
      script.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tags.title, tags.description, tags.canonical, tags.ogImage, jsonLdText]);
}
