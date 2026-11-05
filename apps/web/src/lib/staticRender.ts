import { createContext, useContext } from 'react';
/** True inside the hidden copy of a card that is drawn to a picture: animations and count-ups show their final state. */
export const StaticRender = createContext(false);
export const useStaticRender = () => useContext(StaticRender);
