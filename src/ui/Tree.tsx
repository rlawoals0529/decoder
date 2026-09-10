import { peers } from "../detect/score";
import type { Node, Result, StopReason } from "../detect/engine";
import { Peers } from "./Finding";

/**
 * What was inside what you pasted, in the order it was found.
 *
 * Indentation carries the nesting rather than a box per level. Boxes inside boxes is the
 * loudest tell that a page was assembled rather than designed, and here it would also be
 * wrong: the depth is the only thing the reader needs, and a rule down the left says it in
 * one pixel.
 */

const WHY: Record<StopReason, string> = {
  depth: "it is nested deeper than this goes by default",
  nodes: "there was more here than one pass expands",
  time: "expanding all of it was taking too long",
};

/** How this node relates to its parent, in words rather than an arrow. */
const RELATION: Record<NonNullable<Node["relation"]>, string> = {
  decoded: "decoded from",
  extracted: "found in",
  parsed: "parsed out of",
};

/**
 * One node and everything under it.
 *
 * `all` is the whole flat list, deliberately, and it is passed down unchanged. An earlier
 * version handed each level its own siblings as the pool to search for children, which
 * looked equivalent and quietly capped the tree at two levels: the timestamp inside a JWT
 * payload was found, counted in the total, and never rendered. The count disagreeing with
 * the screen is what gave it away.
 */
function Branch({
  node,
  all,
  onExpand,
}: {
  node: Node;
  all: readonly Node[];
  onExpand: (node: Node) => void;
}) {
  const children = childrenOf(node, all);

  const shown = peers(node.findings);

  return (
    <li className="branch" data-testid={`node-${node.id}`} data-depth={node.depth}>
      {node.label !== null && (
        <p className="branch-label">
          <span className="relation">{node.relation ? RELATION[node.relation] : "from"}</span>{" "}
          <code>{node.label}</code>
        </p>
      )}

      {shown.length === 0 ? (
        <p className="nothing">
          Nothing here matched anything this knows about. That is an answer: it means the
          value is not one of the shapes below, not that it failed to look.
        </p>
      ) : (
        <Peers findings={shown} />
      )}

      {node.stoppedBecause && (
        // Never a silent truncation. The reader gets to decide whether to spend another
        // pass on it, which turns a budget into a choice instead of a limit they cannot see.
        <p className="stopped" data-testid={`stopped-${node.id}`}>
          <span>Stopped expanding here, because {WHY[node.stoppedBecause]}.</span>
          <button type="button" onClick={() => onExpand(node)}>
            Expand this
          </button>
        </p>
      )}

      {children.length > 0 && (
        <ul className="children">
          {children.map((c) => (
            <Branch key={c.id} node={c} all={all} onExpand={onExpand} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Direct children only. The list is flat, so this is where the shape comes from. */
function childrenOf(node: Node, all: readonly Node[]): Node[] {
  return all.filter((n) => n.parentId === node.id);
}

export function Tree({ result, onExpand }: { result: Result; onExpand: (node: Node) => void }) {
  const root = result.nodes.find((n) => n.parentId === null);
  if (!root) return null;

  return (
    <>
      {result.inputTruncated && (
        <p className="truncated" data-testid="truncated">
          Only the first part of what you pasted was read. Anything past 64 KB is more than
          this looks at in one pass, and reading it all would freeze the page rather than
          finish.
        </p>
      )}
      <ul className="tree">
        <Branch node={root} all={result.nodes} onExpand={onExpand} />
      </ul>
    </>
  );
}
