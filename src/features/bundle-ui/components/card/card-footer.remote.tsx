import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";
import { attributes, events, TAG } from "./card-footer.contract";

const CardFooterElement = defineRemoteElement(TAG, attributes, events);

export const CardFooter = makeAuthorComponent(TAG, CardFooterElement, events);
