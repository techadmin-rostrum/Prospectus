import { createContext } from 'react';

/**
 * Current page index, published to the page elements out of band.
 *
 * The render window (which pages hold a painted canvas) has to follow the
 * reader, but it must not travel as props: StPageFlip rebuilds its entire page
 * collection whenever the children array changes identity, so a prop that
 * changes on every turn destroys the book mid-animation.
 */
export const PageWindowContext = createContext(0);
