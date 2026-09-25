/* The memory mechanisms, in the site's order (counterparts-site
   features/home-v2/content/regions.ts, the two parked ones left out), and the
   four families they are grouped by. One folder per mechanism; each module's
   default export is { id, family, name, short, tagline, inDev, explainer,
   built, inDevelopment } (the last two: plain-word bullets).
   Whether it is firing comes from `/api/mechanisms` (views/mechanisms.ts).

   A mechanism with a picture of this store's own data has a `panel.js` beside
   its `index.js` (export `picture(payload)`, pure markup from
   `/api/mechanism?id=`); PANELS below is the one place they are gathered, so a
   mechanism built later ships its folder and one line here. */
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
import * as associationPanel from "./association/panel.js";
import * as consolidationPanel from "./consolidation/panel.js";
import * as decayPanel from "./decay/panel.js";
import * as reconsolidationPanel from "./reconsolidation/panel.js";
import * as retrievalPanel from "./retrieval/panel.js";
import * as saliencePanel from "./salience/panel.js";

export const MECHANISMS = [salience, emotional, decay, interference, retrieval, association, prospective, consolidation, reconsolidation, episodic_semantic, schema];

/** The pill groups, in the order a memory lives through them — the site's colours. */
export const FAMILIES = [
  { key: "encoding", label: "Encoding", color: "#00e5ff" },
  { key: "storage", label: "Storage", color: "#80a8ff" },
  { key: "retrieval", label: "Retrieval", color: "#ffc94d" },
  { key: "transformation", label: "Transformation", color: "#b387ff" },
];

/** Each mechanism's picture, by id. A mechanism missing here shows no picture. */
export const PANELS = {
  salience: saliencePanel,
  decay: decayPanel,
  retrieval: retrievalPanel,
  association: associationPanel,
  consolidation: consolidationPanel,
  reconsolidation: reconsolidationPanel,
};

/**
 * "See how it works": the mechanism's plate in the site's Field Guide
 * (counterparts.ai/ecosystem, each plate carries its mechanism id as its
 * anchor). The Field Guide has no association plate, so that one links the
 * home page's own mechanism panel instead.
 */
const SITE = "https://counterparts.ai";
const NO_PLATE = { association: SITE + "/#brain" };
export function guideUrl(id) {
  return NO_PLATE[id] || SITE + "/ecosystem/#" + id;
}
