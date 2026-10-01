type AccessKind = 'read' | 'retire';
type Waiter = { kind: AccessKind; grant: () => void };
type AccessState = { readers: number; retiring: boolean; queue: Waiter[] };
const accessByJob = new Map<string, AccessState>();

function advanceQueue(jobDuplicateKey: string, state: AccessState): void {
    if (state.retiring) return;
    while (state.queue[0]?.kind === 'read') {
        state.readers++;
        state.queue.shift()!.grant();
    }
    if (state.readers > 0) return;
    const retirement = state.queue.shift();
    if (retirement) {
        state.retiring = true;
        retirement.grant();
    } else {
        accessByJob.delete(jobDuplicateKey);
    }
}

function acquireAccess(
    jobDuplicateKey: string,
    kind: AccessKind,
): Promise<() => void> {
    let state = accessByJob.get(jobDuplicateKey);
    if (!state) {
        state = { readers: 0, retiring: false, queue: [] };
        accessByJob.set(jobDuplicateKey, state);
    }
    const current = state;
    return new Promise((resolve) => {
        current.queue.push({
            kind,
            grant: () =>
                resolve(() => {
                    if (kind === 'read') current.readers--;
                    else current.retiring = false;
                    advanceQueue(jobDuplicateKey, current);
                }),
        });
        advanceQueue(jobDuplicateKey, current);
    });
}

async function withAccess<Result>(
    jobDuplicateKey: string,
    kind: AccessKind,
    operation: () => Promise<Result>,
): Promise<Result> {
    const release = await acquireAccess(jobDuplicateKey, kind);
    try {
        return await operation();
    } finally {
        release();
    }
}

// Register before the first database lookup, not after obtaining a file path.
export function withCvReadLease<Result>(
    jobDuplicateKey: string,
    operation: () => Promise<Result>,
): Promise<Result> {
    return withAccess(jobDuplicateKey, 'read', operation);
}

// Wait within the upload's client lifetime; ownership must be read again here.
// New readers queue behind retirement and then read current primary metadata.
export function withCvRetirementLease<Result>(
    jobDuplicateKey: string,
    operation: () => Promise<Result>,
): Promise<Result> {
    return withAccess(jobDuplicateKey, 'retire', operation);
}
