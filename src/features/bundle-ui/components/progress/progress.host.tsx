import { Progress } from "@/shared/ui/progress";

import { makeHostComponent } from "../_shared/make-host-component";
import { attributes } from "./progress.contract";

export const ProgressHost = makeHostComponent(Progress, attributes);
