import { makeAuthorComponent } from "../_shared/author-component";
import { defineRemoteElement } from "../_shared/define-remote-element";
import { attributes, events, TAG } from "./checkbox.contract";

const CheckboxElement = defineRemoteElement(TAG, attributes, events);

export const Checkbox = makeAuthorComponent(TAG, CheckboxElement, events);
