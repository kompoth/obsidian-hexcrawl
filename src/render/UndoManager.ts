const STACK_LIMIT = 10;

export interface UndoableAction {
	undo(): void | Promise<void>;
	redo(): void | Promise<void>;
}

/**
 * Generic, tool-agnostic undo/redo stack shared by every tool that mutates vault notes
 * (brush/bucket/icon field writes, path edits). Each push represents one user-perceived
 * action — a click, a whole drag-stroke, a path edit — callers batch their own underlying
 * writes into a single action before pushing. Both stacks are capped at 10 entries, and any
 * new push clears the redo stack (standard undo/redo semantics).
 */
export class UndoManager {
	private undoStack: UndoableAction[] = [];
	private redoStack: UndoableAction[] = [];

	push(action: UndoableAction): void {
		this.undoStack.push(action);
		if (this.undoStack.length > STACK_LIMIT) this.undoStack.shift();
		this.redoStack = [];
	}

	async undo(): Promise<void> {
		const action = this.undoStack.pop();
		if (!action) return;
		await action.undo();
		this.redoStack.push(action);
		if (this.redoStack.length > STACK_LIMIT) this.redoStack.shift();
	}

	async redo(): Promise<void> {
		const action = this.redoStack.pop();
		if (!action) return;
		await action.redo();
		this.undoStack.push(action);
		if (this.undoStack.length > STACK_LIMIT) this.undoStack.shift();
	}
}
