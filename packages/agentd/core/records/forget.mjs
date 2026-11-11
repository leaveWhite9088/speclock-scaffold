/** A project is removed: drop what the records hold in memory about it, so that nothing writes its folder back. */

import { forgetProject as forgetJournal } from './journal.mjs';
import { forgetProject as forgetTasks } from './tasks.mjs';

export function forgetProject(project) {
  forgetJournal(project);
  forgetTasks(project);
}
