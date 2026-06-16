import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";
import { attributes, events, TAG } from "./card-content.contract";

const CardContentElement = defineRemoteElement(TAG, attributes, events);

export const CardContent = makeAuthorComponent(TAG, CardContentElement, events);
