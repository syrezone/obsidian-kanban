interface FocusableBoard {
  containerEl: HTMLElement;
}

/**
 * Personal build: remembers the board the user last clicked or focused, so commands can
 * reach boards embedded in other views (canvas cards), not only Kanban tabs.
 */
export class BoardFocus<B extends FocusableBoard> {
  private board: B | null = null;

  constructor(private boards: () => Iterable<B>) {}

  /** Capture-phase pointerdown/focusin handler; anything outside a board clears it. */
  track = (event: Event) => {
    const target = event.target as Node;
    this.board = null;
    for (const board of this.boards()) {
      if (board.containerEl.contains(target)) this.board = board;
    }
  };

  /** A board that is going away is no longer focused. */
  forget(board: B) {
    if (this.board === board) this.board = null;
  }

  /** The focused board, if it is shown inside `viewEl` (the active view's container). */
  within(viewEl: HTMLElement | undefined): B | null {
    return this.board && viewEl?.contains(this.board.containerEl) ? this.board : null;
  }
}
