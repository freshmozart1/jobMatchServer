export class DeadlineExceededError extends Error {
    constructor(readonly deadlineMs: number) {
        super(`Operation exceeded its ${deadlineMs} ms deadline`);
        this.name = 'DeadlineExceededError';
    }
}

/**
 * Bounds how long the caller waits for an operation. This does not cancel the
 * underlying work, which may settle after the returned promise has rejected.
 */
export async function withDeadline<T>(
    operation: () => Promise<T>,
    deadlineMs: number,
): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(
            () => reject(new DeadlineExceededError(deadlineMs)),
            deadlineMs,
        );
    });

    try {
        return await Promise.race([operation(), deadline]);
    } finally {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
}
