import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";
import { attributes, events, TAG } from "./button.contract";

const ButtonElement = defineRemoteElement(TAG, attributes, events);

export const Button = makeAuthorComponent(TAG, ButtonElement, events);
