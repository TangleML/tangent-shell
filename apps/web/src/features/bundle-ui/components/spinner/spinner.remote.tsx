import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";
import { attributes, events, TAG } from "./spinner.contract";

const SpinnerElement = defineRemoteElement(TAG, attributes, events);

export const Spinner = makeAuthorComponent(TAG, SpinnerElement, events);
