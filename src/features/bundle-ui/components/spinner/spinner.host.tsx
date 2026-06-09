import { Spinner } from "@/shared/ui/spinner";

import { makeHostComponent } from "../_shared/make-host-component";
import { attributes } from "./spinner.contract";

export const SpinnerHost = makeHostComponent(Spinner, attributes);
