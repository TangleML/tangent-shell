import { ScoreRing } from "@tangent/ui-primitives/score-ring";

import { makeHostComponent } from "../_shared/make-host-component";
import { attributes } from "./score-ring.contract";

export const ScoreRingHost = makeHostComponent(ScoreRing, attributes);
