/**
 * A plain, serializable SVG element tree and its string serializer.
 *
 * Why a tree and not only a string: the renderer has two consumers.
 *
 *   - The canonical STATIC artifact is the SVG string — what tests assert
 *     byte-for-byte, what a web view or an export shows, and what the
 *     deterministic re-render A/B (#15) diffs across grammar/base versions.
 *   - The future `CueDiagram` component (deferred until a planned native build
 *     adds `react-native-svg`) needs elements it can map one-to-one onto
 *     `<Line>`, `<Circle>`, `<Path>`… and layer motion onto the nodes that
 *     carry a `data-fd-anim` hook. Handing it a string would mean parsing XML
 *     back into elements on device.
 *
 * The tree is plain JSON (no classes, no functions), so it is also safe to
 * snapshot, log or ship across the edge boundary. Attribute values are
 * pre-formatted strings and are emitted in insertion order, so a given tree
 * always serializes to the same bytes.
 *
 * Dependency-free on purpose (no `@/`, node or React Native imports).
 */

export interface SvgElement {
  tag: string;
  /** SVG attribute name (kebab-case, as in markup) -> formatted value. */
  attrs: Record<string, string>;
  /** Child elements, or plain strings for text content. */
  children: (SvgElement | string)[];
}

export function el(
  tag: string,
  attrs: Record<string, string> = {},
  children: (SvgElement | string)[] = [],
): SvgElement {
  return { tag, attrs, children };
}

/**
 * Format a coordinate: rounded to 0.01 px. Fixed precision is what makes the
 * output byte-stable, and it absorbs last-digit differences in `Math.sin` /
 * `Math.cos` between JS engines.
 */
export function num(n: number): string {
  const r = Math.round(n * 100) / 100;
  return String(Object.is(r, -0) ? 0 : r);
}

const escapeText = (s: string): string =>
  s.replace(/[&<>]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;',
  );

const escapeAttr = (s: string): string => escapeText(s).replace(/"/g, '&quot;');

/** Serialize a tree to SVG markup. Childless elements self-close. */
export function serializeSvg(node: SvgElement | string): string {
  if (typeof node === 'string') return escapeText(node);
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join('');
  if (node.children.length === 0) return `<${node.tag}${attrs}/>`;
  return `<${node.tag}${attrs}>${node.children.map(serializeSvg).join('')}</${node.tag}>`;
}
