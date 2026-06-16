import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";
import { attributes, events, TAG } from "./card-header.contract";

const CardHeaderElement = defineRemoteElement(TAG, attributes, events);

export const CardHeader = makeAuthorComponent(TAG, CardHeaderElement, events);
