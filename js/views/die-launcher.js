/* Lightweight entry point used by daily production rows. The full section
   book and its drawing library are downloaded only when somebody asks for a
   die, rather than on every app launch. */

import { toast } from '../ui.js';

let feature = null;

export async function dieDialog(initial = '') {
  try {
    if (!feature) {
      toast('Loading die lookup…');
      feature = import('./dies.js');
    }
    const module = await feature;
    return module.dieDialog(initial);
  } catch {
    feature = null;
    toast('Die lookup needs a connection the first time');
    return null;
  }
}
