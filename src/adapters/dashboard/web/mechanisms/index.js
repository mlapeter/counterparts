/* The memory mechanisms, in the site's order (counterparts-site
   features/home-v2/content/regions.ts, the two parked ones left out), and the
   four families they are grouped by. One folder per mechanism; each module's
   default export is { id, family, name, short, tagline, inDev, explainer }.
   Whether it is firing comes from `/api/mechanisms` (views/mechanisms.ts). */
import salience from "./salience/index.js";
import emotional from "./emotional/index.js";
import decay from "./decay/index.js";
import interference from "./interference/index.js";
import retrieval from "./retrieval/index.js";
import association from "./association/index.js";
import prospective from "./prospective/index.js";
import consolidation from "./consolidation/index.js";
import reconsolidation from "./reconsolidation/index.js";
import episodic_semantic from "./episodic-semantic/index.js";
import schema from "./schema/index.js";

export const MECHANISMS = [salience, emotional, decay, interference, retrieval, association, prospective, consolidation, reconsolidation, episodic_semantic, schema];

/** The pill groups, in the order a memory lives through them — the site's colours. */
export const FAMILIES = [
  { key: "encoding", label: "Encoding", color: "#00e5ff" },
  { key: "storage", label: "Storage", color: "#80a8ff" },
  { key: "retrieval", label: "Retrieval", color: "#ffc94d" },
  { key: "transformation", label: "Transformation", color: "#b387ff" },
];
