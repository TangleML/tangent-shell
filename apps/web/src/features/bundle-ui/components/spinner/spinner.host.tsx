import { attributes } from "@tangent/ui-extensions-sdk/contracts/spinner";
import { Spinner } from "@tangent/ui-primitives/spinner";

import { makeHostComponent } from "../_shared/make-host-component";

export const SpinnerHost = makeHostComponent(Spinner, attributes);
