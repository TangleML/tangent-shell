import { Spinner } from "@tangent/ui-primitives/spinner";

import { makeHostComponent } from "../_shared/make-host-component";
import { attributes } from "./spinner.contract";

export const SpinnerHost = makeHostComponent(Spinner, attributes);
