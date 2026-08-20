import { attributes } from "@tangent/ui-extensions-sdk/contracts/score-ring";
import { ScoreRing } from "@tangent/ui-primitives/score-ring";

import { makeHostComponent } from "../_shared/make-host-component";

export const ScoreRingHost = makeHostComponent(ScoreRing, attributes);
