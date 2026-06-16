import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";
import { attributes, events, TAG } from "./card-title.contract";

const CardTitleElement = defineRemoteElement(TAG, attributes, events);

export const CardTitle = makeAuthorComponent(TAG, CardTitleElement, events);
