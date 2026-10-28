// Personal build: subtask helpers. Task list items of the note linked by a card.

// Same line pattern as checkCheckbox in ItemContent.tsx.
const taskLineRegEx = /^(\s*>)*(\s*[-+*]\s+?\[)([^\]])(\]\s+)/;

export interface LinkedTask {
  line: number;
  text: string;
  checked: boolean;
}

/** Task lines of a note, given the cache's task line numbers. */
export function readLinkedTasks(content: string, taskLines: number[]): LinkedTask[] {
  const lines = content.split(/\r?\n/);
  const tasks: LinkedTask[] = [];
  for (const line of taskLines) {
    const match = lines[line]?.match(taskLineRegEx);
    const text = match ? lines[line].slice(match[0].length).trim() : '';
    if (text) tasks.push({ line, text, checked: match[3] !== ' ' });
  }
  return tasks;
}

/**
 * Flip the previewed task. Returns the content unchanged when its line no longer holds
 * that task (the note changed since the preview was read).
 */
export function toggleTaskLine(content: string, task: LinkedTask, doneChar: string): string {
  const { line } = task;
  const lines = content.split('\n');
  const match = lines[line]?.match(taskLineRegEx);
  if (!match || lines[line].slice(match[0].length).trim() !== task.text) return content;
  const check = match[3] === ' ' ? doneChar : ' ';
  lines[line] = (match[1] ?? '') + match[2] + check + match[4] + lines[line].slice(match[0].length);
  return lines.join('\n');
}
