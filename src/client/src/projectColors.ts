export interface ProjectColorOption {
  readonly name: string;
  readonly value: string;
}

/** Hand-picked mid-tone hues that stay legible against both the light and dark PI WEB surfaces. */
export const PROJECT_COLORS: readonly ProjectColorOption[] = [
  { name: "Red", value: "#e5484d" },
  { name: "Orange", value: "#f76b15" },
  { name: "Amber", value: "#ffb224" },
  { name: "Green", value: "#30a46c" },
  { name: "Teal", value: "#12a594" },
  { name: "Blue", value: "#0091ff" },
  { name: "Indigo", value: "#3e63dd" },
  { name: "Purple", value: "#8e4ec6" },
  { name: "Pink", value: "#d6409f" },
  { name: "Gray", value: "#8f8f8f" },
];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Normalises to lowercase `#rrggbb` so palette equality checks and the server's validation agree. */
export function normalizeProjectColor(value: string): string | undefined {
  const trimmed = value.trim();
  const expanded = /^#[0-9a-f]{3}$/i.test(trimmed)
    ? `#${trimmed.slice(1).replace(/./g, (char) => `${char}${char}`)}`
    : trimmed;
  return HEX_COLOR.test(expanded) ? expanded.toLowerCase() : undefined;
}

export function projectColorName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return PROJECT_COLORS.find((option) => option.value.toLowerCase() === value.toLowerCase())?.name;
}

/** Opacity of the tint laid over the row surface, per row state. */
const TINT_ALPHA = { rest: 0.22, hover: 0.34, selected: 0.45 } as const;

/**
 * Builds the inline custom properties that tint a project row.
 *
 * The tints are translucent overlays rather than solid colours so the theme's own surface shows
 * through, which keeps the row readable on both the light and dark themes without this module
 * needing to know which one is active. Returns "" for a colour it cannot parse, leaving the row
 * untinted rather than emitting a broken style attribute.
 */
export function projectTintStyle(color: string | undefined): string {
  if (color === undefined) return "";
  const normalized = normalizeProjectColor(color);
  if (normalized === undefined) return "";
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  const tint = (alpha: number) => `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(alpha)})`;
  return [
    `--pi-project-color: ${normalized};`,
    `--pi-project-tint: ${tint(TINT_ALPHA.rest)};`,
    `--pi-project-tint-hover: ${tint(TINT_ALPHA.hover)};`,
    `--pi-project-tint-selected: ${tint(TINT_ALPHA.selected)};`,
  ].join(" ");
}
