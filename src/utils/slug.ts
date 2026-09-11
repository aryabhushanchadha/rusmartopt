/**
 * Cyrillic-aware slugification for public marketplace URLs.
 *
 * Uses the standard "practical" RU→Latin transliteration scheme (close to
 * what Yandex's own URL transliteration uses) rather than URL-encoding
 * Cyrillic directly — transliterated Latin slugs are the common convention
 * for RU sites and avoid ugly %D0%A1%... URLs in shared links/browser bars.
 */
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh",
  щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function transliterate(input: string): string {
  return input
    .toLowerCase()
    .split("")
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join("");
}

/** Base slugify: transliterate, lowercase, non-alphanumeric -> "-", collapse/trim. */
export function slugify(input: string): string {
  const translit = transliterate(input);
  return translit
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "item";
}

/**
 * Generates a slug guaranteed unique per `exists()`, trying the base slug
 * first, then `-2`, `-3`, ... . `exists` should check whatever uniqueness
 * scope applies (global for Company.slug, per-company for Listing.slug).
 */
export async function uniqueSlug(
  base: string,
  exists: (candidate: string) => Promise<boolean>
): Promise<string> {
  const baseSlug = slugify(base);
  let candidate = baseSlug;
  let n = 2;
  while (await exists(candidate)) {
    candidate = `${baseSlug}-${n}`;
    n++;
  }
  return candidate;
}
