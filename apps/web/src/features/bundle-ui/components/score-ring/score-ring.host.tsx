import { ScoreRing } from "@/shared/ui/score-ring";

import { makeHostComponent } from "../_shared/make-host-component";
import { attributes } from "./score-ring.contract";

export const ScoreRingHost = makeHostComponent(ScoreRing, attributes);
