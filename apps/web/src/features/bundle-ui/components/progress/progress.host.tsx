import { attributes } from "@tangent/ui-extensions-sdk/contracts/progress";
import { Progress } from "@tangent/ui-primitives/progress";

import { makeHostComponent } from "../_shared/make-host-component";

export const ProgressHost = makeHostComponent(Progress, attributes);
