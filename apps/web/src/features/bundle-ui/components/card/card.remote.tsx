import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";
import { attributes, events, TAG } from "./card.contract";

const CardElement = defineRemoteElement(TAG, attributes, events);

export const Card = makeAuthorComponent(TAG, CardElement, events);
